
const boardElement = document.getElementById('board');
const evalElement = document.getElementById('evaluation');
const bestMoveElement = document.getElementById('best-move');
const pvElement = document.getElementById('principal-variation');
const arrowLayer = document.getElementById('arrow-layer');

const game = new Chess();

let selectedSquare = null;
let flipped = false;
let currentDepth = 22;

let stockfish;
let engineReady = false;
let searching = false;
let pendingAnalysis = false;

let analysisVersion = 0;
let activeVersion = 0;
let activeFen = null;
let lastBestMove = null;

const files = 'abcdefgh';

// ======================================
// ENGINE INITIALIZATION
// ======================================

try {
    stockfish = new Worker('stockfish-19-asm.js');

    stockfish.onmessage = function(event) {
        const line = String(event.data || '').trim();

        if (line === 'uciok') {
            stockfish.postMessage('isready');
            return;
        }

        if (line === 'readyok') {
            engineReady = true;
            startAnalysis();
            return;
        }

        if (line.startsWith('info depth')) {
            if (activeVersion !== analysisVersion) return;
            handleEngineInfo(line);
            return;
        }

        if (line.startsWith('bestmove')) {
            searching = false;

            if (activeVersion !== analysisVersion || pendingAnalysis) {
                pendingAnalysis = false;
                startAnalysis();
                return;
            }

            const parts = line.split(/\s+/);
            const uci = parts[1];

            if (!uci || uci === '(none)') {
                bestMoveElement.textContent = 'No legal move';
                pvElement.textContent = '-';
                lastBestMove = null;
                drawArrow();
                return;
            }

            displayBestMove(uci);
        }
    };

    stockfish.onerror = function(error) {
        console.error('Stockfish error:', error);
        bestMoveElement.textContent = 'Engine Error';
        pvElement.textContent = 'Check Stockfish file';
    };

    stockfish.postMessage('uci');

} catch (error) {
    console.error(error);
    bestMoveElement.textContent = 'Engine unavailable';
}


// ======================================
// ENGINE MODE
// ======================================

function setMode(btn) {
    document.querySelectorAll('.mode-btn').forEach(button => {
        button.classList.remove('active');
    });

    btn.classList.add('active');

    currentDepth = Number(btn.dataset.depth);

    analyzePosition();
}


// ======================================
// BOARD RENDER
// ======================================

function renderBoard() {
    boardElement.innerHTML = '';

    // Jangan gunakan rotate(180deg).
    // Posisi bidak diubah melalui urutan kotak.

    boardElement.style.transform = 'none';
    arrowLayer.style.transform = 'none';

    const board = game.board();

    for (let displayRow = 0; displayRow < 8; displayRow++) {
        for (let displayCol = 0; displayCol < 8; displayCol++) {

            const rank = flipped
                ? displayRow + 1
                : 8 - displayRow;

            const fileIndex = flipped
                ? 7 - displayCol
                : displayCol;

            const pos = files[fileIndex] + rank;

            const square = document.createElement('div');

            const isLight = (rank + fileIndex) % 2 === 0;

            square.className = `square ${isLight ? 'light' : 'dark'}`;
            square.dataset.pos = pos;

            square.style.position = 'relative';
            square.style.overflow = 'hidden';

            const piece = game.get(pos);

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

                square.textContent = symbols[
                    piece.color === 'w'
                        ? piece.type.toUpperCase()
                        : piece.type
                ];

                square.style.color =
                    piece.color === 'w' ? '#ffffff' : '#000000';
            }

            // Coordinate labels

            if (displayCol === 0) {
                const rankLabel = document.createElement('span');

                rankLabel.textContent = rank;
                rankLabel.style.cssText = `
                    position:absolute;
                    top:2px;
                    left:4px;
                    font-size:10px;
                    font-weight:800;
                    opacity:.7;
                    pointer-events:none;
                    z-index:3;
                    color:inherit;
                `;

                square.appendChild(rankLabel);
            }

            if (displayRow === 7) {
                const fileLabel = document.createElement('span');

                fileLabel.textContent = files[fileIndex];
                fileLabel.style.cssText = `
                    position:absolute;
                    bottom:2px;
                    right:4px;
                    font-size:10px;
                    font-weight:800;
                    opacity:.7;
                    pointer-events:none;
                    z-index:3;
                    color:inherit;
                `;

                square.appendChild(fileLabel);
            }

            square.addEventListener('click', () => {
                handleSquareClick(square);
            });

            boardElement.appendChild(square);
        }
    }

    if (selectedSquare) {
        highlightSelected(selectedSquare);
        showLegalMoves(selectedSquare);
    }

    if (lastBestMove) {
        drawArrow(lastBestMove.from, lastBestMove.to);
    }
}


// ======================================
// SELECTED SQUARE
// ======================================

function highlightSelected(pos) {
    const square = boardElement.querySelector(
        `[data-pos="${pos}"]`
    );

    if (!square) return;

    square.style.boxShadow = 'inset 0 0 0 4px #facc15';
}


// ======================================
// LEGAL MOVE INDICATORS
// ======================================

function showLegalMoves(from) {
    const moves = game.moves({
        square: from,
        verbose: true
    });

    moves.forEach(move => {
        const square = boardElement.querySelector(
            `[data-pos="${move.to}"]`
        );

        if (!square) return;

        const marker = document.createElement('span');

        marker.className = 'legal-dot';

        marker.style.cssText = `
            position:absolute;
            width:25%;
            height:25%;
            top:50%;
            left:50%;
            transform:translate(-50%,-50%);
            border-radius:50%;
            background:rgba(25,100,45,.65);
            pointer-events:none;
            z-index:5;
        `;

        if (move.captured) {
            marker.style.width = '85%';
            marker.style.height = '85%';
            marker.style.background = 'transparent';
            marker.style.border = '5px solid rgba(25,100,45,.65)';
        }

        square.appendChild(marker);
    });
}


// ======================================
// CLICK INTERACTION
// ======================================

function handleSquareClick(square) {
    const pos = square.dataset.pos;
    const piece = game.get(pos);

    if (game.game_over()) return;

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
                lastBestMove = null;

                renderBoard();
                analyzePosition();

                return;
            }
        }

        if (piece && piece.color === game.turn()) {
            selectedSquare = pos;
            renderBoard();
            return;
        }

        selectedSquare = null;
        renderBoard();

        return;
    }

    if (piece && piece.color === game.turn()) {
        selectedSquare = pos;
        renderBoard();
    }
}


// ======================================
// CONVERT UCI TO SAN
// ======================================

function uciToSan(uci, fen) {
    try {
        const temp = new Chess(fen);

        const move = temp.move({
            from: uci.substring(0, 2),
            to: uci.substring(2, 4),
            promotion: uci.substring(4, 5) || 'q'
        });

        return move ? move.san : uci;

    } catch (error) {
        return uci;
    }
}


// ======================================
// PRINCIPAL VARIATION
// ======================================

function convertPV(pv, fen) {
    try {
        const temp = new Chess(fen);
        const moves = pv.trim().split(/\s+/);

        const result = [];

        moves.forEach(uci => {
            const move = temp.move({
                from: uci.substring(0, 2),
                to: uci.substring(2, 4),
                promotion: uci.substring(4, 5) || 'q'
            });

            if (move) {
                result.push(move.san);
            }
        });

        return result.join(' ');

    } catch (error) {
        return pv;
    }
}


// ======================================
// DISPLAY BEST MOVE
// ======================================

function displayBestMove(uci) {
    const from = uci.substring(0, 2);
    const to = uci.substring(2, 4);

    const san = uciToSan(uci, activeFen);

    lastBestMove = { from, to };

    bestMoveElement.innerHTML = `
        <div style="
            font-size:25px;
            font-weight:900;
            color:#81b64c;
        ">${san}</div>

        <div style="
            font-size:11px;
            color:#8994a5;
            margin-top:5px;
        ">
            ${from} → ${to}
        </div>
    `;

    drawArrow(from, to);
}


// ======================================
// DRAW ANALYSIS ARROW
// ======================================

function drawArrow(from, to) {
    arrowLayer.innerHTML = '';

    if (!from || !to) return;

    const fromFile = files.indexOf(from[0]);
    const fromRank = Number(from[1]);

    const toFile = files.indexOf(to[0]);
    const toRank = Number(to[1]);

    // Posisi visual menyesuaikan orientasi papan.

    const x1 = ((flipped ? 7 - fromFile : fromFile) * 60) + 30;
    const y1 = ((flipped ? fromRank - 1 : 8 - fromRank) * 60) + 30;

    const x2 = ((flipped ? 7 - toFile : toFile) * 60) + 30;
    const y2 = ((flipped ? toRank - 1 : 8 - toRank) * 60) + 30;

    const ns = 'http://www.w3.org/2000/svg';

    const defs = document.createElementNS(ns, 'defs');

    defs.innerHTML = `
        <marker
            id="vinnx-arrowhead"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
        >
            <polygon
                points="0 0, 10 5, 0 10"
                fill="#ffd700"
            />
        </marker>
    `;

    arrowLayer.appendChild(defs);

    const arrow = document.createElementNS(ns, 'line');

    arrow.setAttribute('x1', x1);
    arrow.setAttribute('y1', y1);
    arrow.setAttribute('x2', x2);
    arrow.setAttribute('y2', y2);

    arrow.setAttribute('stroke', '#ffd700');
    arrow.setAttribute('stroke-width', '8');
    arrow.setAttribute('stroke-linecap', 'round');
    arrow.setAttribute('marker-end', 'url(#vinnx-arrowhead)');
    arrow.setAttribute('opacity', '0.9');

    arrowLayer.appendChild(arrow);
}


// ======================================
// ENGINE INFO
// ======================================

function handleEngineInfo(line) {
    const cpMatch = line.match(/score cp (-?\d+)/);
    const mateMatch = line.match(/score mate (-?\d+)/);

    const turn = activeFen.split(' ')[1];

    if (cpMatch) {
        let score = Number(cpMatch[1]) / 100;

        if (turn === 'b') score *= -1;

        evalElement.textContent =
            (score > 0 ? '+' : '') + score.toFixed(2);

    } else if (mateMatch) {
        let mate = Number(mateMatch[1]);

        if (turn === 'b') mate *= -1;

        evalElement.textContent =
            mate > 0
                ? `M${mate}`
                : `-M${Math.abs(mate)}`;
    }

    const pvMatch = line.match(/\spv (.+)$/);

    if (pvMatch) {
        const pv = convertPV(pvMatch[1], activeFen);

        pvElement.textContent = pv || '-';
    }
}


// ======================================
// ANALYSIS CONTROL
// ======================================

function analyzePosition() {
    analysisVersion++;

    lastBestMove = null;

    arrowLayer.innerHTML = '';

    bestMoveElement.textContent = 'Analyzing...';
    pvElement.textContent = 'Calculating...';

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

    activeVersion = analysisVersion;
    activeFen = game.fen();

    searching = true;

    stockfish.postMessage('position fen ' + activeFen);
    stockfish.postMessage('go depth ' + currentDepth);
}


// ======================================
// RESET
// ======================================

document.getElementById('reset-btn').addEventListener('click', () => {
    game.reset();

    selectedSquare = null;
    lastBestMove = null;

    evalElement.textContent = '0.00';
    bestMoveElement.textContent = 'Analyzing...';
    pvElement.textContent = 'Calculating...';

    arrowLayer.innerHTML = '';

    renderBoard();
    analyzePosition();
});


// ======================================
// FLIP BOARD
// ======================================

document.getElementById('flip-btn').addEventListener('click', () => {
    flipped = !flipped;

    selectedSquare = null;

    renderBoard();

    // Panah ikut menyesuaikan orientasi.
    if (lastBestMove) {
        drawArrow(lastBestMove.from, lastBestMove.to);
    }
});


// ======================================
// INITIALIZATION
// ======================================

renderBoard();

evalElement.textContent = '0.00';
bestMoveElement.textContent = 'Waiting for Stockfish...';
pvElement.textContent = 'Waiting for Stockfish...';
