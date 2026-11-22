const boardElement = document.getElementById('board');
const evalElement = document.getElementById('evaluation');
const bestMoveElement = document.getElementById('best-move');
const pvElement = document.getElementById('principal-variation');
const arrowLayer = document.getElementById('arrow-layer');

const game = new Chess();

let selectedSquare = null;
let currentDepth = 22;
let stockfish = new Worker('stockfish-19-asm.js');

let engineReady = false;
let searching = false;
let pendingAnalysis = false;
let desiredVersion = 0;
let activeVersion = 0;
let activeFen = null;

// =====================================
// ENGINE INITIALIZATION
// =====================================

stockfish.onmessage = function(event) {
    const line = String(event.data || '').trim();

    if (line === 'uciok') {
        stockfish.postMessage('isready');
        return;
    }

    if (line === 'readyok') {
        engineReady = true;
        analyzePosition();
        return;
    }

    if (line.startsWith('info depth')) {
        if (activeVersion !== desiredVersion) return;

        handleEngineInfo(line);
        return;
    }

    if (line.startsWith('bestmove')) {
        searching = false;

        const parts = line.split(/\s+/);
        const bestMove = parts[1];

        if (activeVersion === desiredVersion && bestMove && bestMove !== '(none)') {
            displayBestMove(bestMove);
        } else if (activeVersion === desiredVersion) {
            bestMoveElement.textContent = 'No legal move';
            pvElement.textContent = '-';
            arrowLayer.innerHTML = '';
        }

        if (pendingAnalysis) {
            pendingAnalysis = false;
            startAnalysis();
        }
    }
};

stockfish.onerror = function(error) {
    console.error('Stockfish error:', error);
    bestMoveElement.textContent = 'Engine Error';
    pvElement.textContent = 'Check engine file';
};

// Start UCI
stockfish.postMessage('uci');


// =====================================
// ENGINE MODE
// =====================================

function setMode(btn) {
    document.querySelectorAll('.mode-btn').forEach(button => {
        button.classList.remove('active');
    });

    btn.classList.add('active');

    currentDepth = parseInt(btn.dataset.depth, 10);

    analyzePosition();
}


// =====================================
// CHESS BOARD
// =====================================

function renderBoard() {
    boardElement.innerHTML = '';

    const board = game.board();

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const square = document.createElement('div');

            const isLight = (r + c) % 2 === 0;

            square.className = `square ${isLight ? 'light' : 'dark'}`;

            const pos = `${String.fromCharCode(97 + c)}${8 - r}`;

            square.dataset.pos = pos;

            const piece = board[r][c];

            if (piece) {
                const symbols = {
                    p: '♟',
                    r: '♜',
                    n: '♞',
                    b: '♝',
                    q: '♛',
                    k: '♚',
                    P: '♙',
                    R: '♖',
                    N: '♘',
                    B: '♗',
                    Q: '♕',
                    K: '♔'
                };

                square.textContent =
                    symbols[piece.color === 'w'
                        ? piece.type.toUpperCase()
                        : piece.type];

                square.style.color =
                    piece.color === 'w' ? '#fff' : '#000';
            }

            square.addEventListener('click', () => {
                handleSquareClick(square);
            });

            boardElement.appendChild(square);
        }
    }

    if (selectedSquare) {
        showLegalMoves(selectedSquare);
    }
}


// =====================================
// LEGAL MOVE INDICATORS
// =====================================

function showLegalMoves(from) {
    const moves = game.moves({
        square: from,
        verbose: true
    });

    const squares = boardElement.querySelectorAll('.square');

    squares.forEach(square => {
        const destination = square.dataset.pos;

        const possible = moves.find(move => move.to === destination);

        if (!possible) return;

        square.classList.add('legal-target');

        const marker = document.createElement('span');

        marker.className = 'legal-dot';

        marker.style.cssText = `
            position:absolute;
            width:25%;
            height:25%;
            border-radius:50%;
            background:rgba(20,90,45,.65);
            top:50%;
            left:50%;
            transform:translate(-50%,-50%);
            pointer-events:none;
            z-index:5;
        `;

        if (possible.captured) {
            marker.style.width = '85%';
            marker.style.height = '85%';
            marker.style.background = 'transparent';
            marker.style.border = '5px solid rgba(20,90,45,.65)';
        }

        square.style.position = 'relative';
        square.appendChild(marker);
    });
}


// =====================================
// SQUARE INTERACTION
// =====================================

function handleSquareClick(square) {
    const pos = square.dataset.pos;
    const piece = game.get(pos);

    if (selectedSquare) {
        const moves = game.moves({
            square: selectedSquare,
            verbose: true
        });

        const legalMove = moves.find(move => move.to === pos);

        if (legalMove) {
            const result = game.move({
                from: selectedSquare,
                to: pos,
                promotion: 'q'
            });

            if (result) {
                selectedSquare = null;

                renderBoard();
                analyzePosition();

                return;
            }
        }

        if (piece && piece.color === game.turn()) {
            selectedSquare = pos;
            renderBoard();

            const selected = boardElement.querySelector(
                `[data-pos="${pos}"]`
            );

            if (selected) selected.classList.add('selected');

            return;
        }

        selectedSquare = null;
        renderBoard();

        return;
    }

    if (piece && piece.color === game.turn()) {
        selectedSquare = pos;

        renderBoard();

        const selected = boardElement.querySelector(
            `[data-pos="${pos}"]`
        );

        if (selected) selected.classList.add('selected');
    }
}


// =====================================
// MOVE CONVERSION
// =====================================

function uciToSan(uci, fen) {
    try {
        const tempGame = new Chess(fen);

        const from = uci.substring(0, 2);
        const to = uci.substring(2, 4);
        const promotion = uci.substring(4, 5);

        const move = tempGame.move({
            from,
            to,
            promotion: promotion || 'q'
        });

        return move ? move.san : uci;

    } catch (error) {
        return uci;
    }
}

function convertPV(pv, fen) {
    try {
        const tempGame = new Chess(fen);

        const moves = pv.trim().split(/\s+/);
        const result = [];

        for (const uci of moves) {
            const from = uci.substring(0, 2);
            const to = uci.substring(2, 4);
            const promotion = uci.substring(4, 5);

            const move = tempGame.move({
                from,
                to,
                promotion: promotion || 'q'
            });

            if (!move) break;

            result.push(move.san);
        }

        return result.join(' ');
    } catch (error) {
        return pv;
    }
}


// =====================================
// DISPLAY BEST MOVE
// =====================================

function displayBestMove(uci) {
    const fen = activeFen;

    const from = uci.substring(0, 2);
    const to = uci.substring(2, 4);

    const san = uciToSan(uci, fen);

    bestMoveElement.innerHTML = `
        <div style="
            font-size:24px;
            font-weight:900;
            color:#81b64c;
        ">${san}</div>

        <div style="
            color:#8994a5;
            font-size:11px;
            margin-top:5px;
        ">${from} → ${to}</div>
    `;

    drawArrow(from, to);
}


// =====================================
// ARROW INDICATOR
// =====================================

function drawArrow(from, to) {
    arrowLayer.innerHTML = '';

    if (!from || !to) return;

    const fromCol = from.charCodeAt(0) - 97;
    const fromRow = 8 - parseInt(from[1], 10);

    const toCol = to.charCodeAt(0) - 97;
    const toRow = 8 - parseInt(to[1], 10);

    const size = 60;

    const x1 = fromCol * size + 30;
    const y1 = fromRow * size + 30;

    const x2 = toCol * size + 30;
    const y2 = toRow * size + 30;

    const defs = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'defs'
    );

    defs.innerHTML = `
        <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
        >
            <polygon
                points="0 0, 6 3, 0 6"
                fill="#ffd700"
            />
        </marker>
    `;

    arrowLayer.appendChild(defs);

    const arrow = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'line'
    );

    arrow.setAttribute('x1', x1);
    arrow.setAttribute('y1', y1);
    arrow.setAttribute('x2', x2);
    arrow.setAttribute('y2', y2);

    arrow.setAttribute('stroke', '#ffd700');
    arrow.setAttribute('stroke-width', '7');
    arrow.setAttribute('stroke-linecap', 'round');
    arrow.setAttribute('marker-end', 'url(#arrowhead)');
    arrow.setAttribute('opacity', '0.9');

    arrowLayer.appendChild(arrow);
}


// =====================================
// ENGINE EVALUATION & PV
// =====================================

function handleEngineInfo(line) {
    const scoreCp = line.match(/score cp (-?\d+)/);
    const scoreMate = line.match(/score mate (-?\d+)/);

    const turn = activeFen.split(' ')[1];

    if (scoreCp) {
        let score = parseInt(scoreCp[1], 10) / 100;

        // Ubah ke sudut pandang putih
        if (turn === 'b') score *= -1;

        const sign = score > 0 ? '+' : '';

        evalElement.textContent = sign + score.toFixed(2);

    } else if (scoreMate) {
        let mate = parseInt(scoreMate[1], 10);

        if (turn === 'b') mate *= -1;

        evalElement.textContent =
            mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
    }

    const pvMatch = line.match(/\spv (.+)$/);

    if (pvMatch) {
        const pv = convertPV(pvMatch[1], activeFen);

        pvElement.textContent = pv || '-';
    }
}


// =====================================
// ANALYSIS CONTROL
// =====================================

function analyzePosition() {
    desiredVersion++;

    bestMoveElement.textContent = 'Analyzing...';
    pvElement.textContent = 'Calculating variation...';

    arrowLayer.innerHTML = '';

    if (!engineReady) return;

    if (searching) {
        pendingAnalysis = true;
        stockfish.postMessage('stop');
        return;
    }

    startAnalysis();
}

function startAnalysis() {
    if (!engineReady) return;

    activeVersion = desiredVersion;
    activeFen = game.fen();

    searching = true;

    stockfish.postMessage('position fen ' + activeFen);
    stockfish.postMessage('go depth ' + currentDepth);
}


// =====================================
// RESET BOARD
// =====================================

document.getElementById('reset-btn').addEventListener('click', () => {
    game.reset();

    selectedSquare = null;

    renderBoard();

    evalElement.textContent = '0.00';
    bestMoveElement.textContent = '-';
    pvElement.textContent = '-';

    arrowLayer.innerHTML = '';

    analyzePosition();
});


// =====================================
// FLIP BOARD
// =====================================

document.getElementById('flip-btn').addEventListener('click', () => {
    const rotated =
        boardElement.style.transform === 'rotate(180deg)';

    boardElement.style.transform =
        rotated ? 'rotate(0deg)' : 'rotate(180deg)';

    arrowLayer.style.transform =
        rotated ? 'rotate(0deg)' : 'rotate(180deg)';
});


// =====================================
// INITIALIZATION
// =====================================

renderBoard();

evalElement.textContent = '0.00';
bestMoveElement.textContent = 'Waiting for engine...';
pvElement.textContent = 'Waiting for engine...';
