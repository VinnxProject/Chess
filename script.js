const boardElement = document.getElementById('board');
const evalElement = document.getElementById('evaluation');
const bestMoveElement = document.getElementById('best-move');
const pvElement = document.getElementById('principal-variation');
const arrowLayer = document.getElementById('arrow-layer');

const game = new Chess();

let selectedSquare = null;
let flipped = false;
let currentDepth = 12;

let stockfish = null;
let engineReady = false;
let searching = false;
let pendingAnalysis = false;
let enginePaused = false;

let analysisVersion = 0;
let activeVersion = 0;
let activeFen = null;
let lastBestMove = null;

const files = 'abcdefgh';

// ======================================
// PIECE SYMBOLS
// ======================================

const pieceSymbols = {
    w: {
        p: '♙', r: '♖', n: '♘',
        b: '♗', q: '♕', k: '♔'
    },
    b: {
        p: '♟', r: '♜', n: '♞',
        b: '♝', q: '♛', k: '♚'
    }
};

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

            if (!enginePaused) {
                startAnalysis();
            }

            updateEngineButtons();
            return;
        }

        if (line.startsWith('info depth')) {
            if (
                enginePaused ||
                activeVersion !== analysisVersion
            ) return;

            handleEngineInfo(line);
            return;
        }

        if (line.startsWith('bestmove')) {
            searching = false;

            if (enginePaused) {
                updateEngineButtons();
                return;
            }

            if (
                activeVersion !== analysisVersion ||
                pendingAnalysis
            ) {
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
                updateEngineButtons();
                return;
            }

            displayBestMove(uci);
            updateEngineButtons();
        }
    };

    stockfish.onerror = function(error) {
        console.error('Stockfish error:', error);

        engineReady = false;
        searching = false;

        bestMoveElement.textContent = 'Engine Error';
        pvElement.textContent = 'Check Stockfish file';

        updateEngineButtons();
    };

    stockfish.postMessage('uci');

} catch (error) {
    console.error(error);

    bestMoveElement.textContent = 'Engine unavailable';
    pvElement.textContent = 'Stockfish could not start';
}

// ======================================
// ENGINE MODE
// ======================================

function setMode(btn) {
    const label = (
        btn.dataset.mode ||
        btn.textContent ||
        ''
    ).trim().toLowerCase();

    let depth = Number(btn.dataset.depth);

    // Fallback jika data-depth belum tersedia

    if (!Number.isFinite(depth) || depth <= 0) {
        if (label.includes('ekstrim') || label.includes('extreme')) {
            depth = 22;
        } else if (label.includes('bijak') || label.includes('wise')) {
            depth = 18;
        } else {
            depth = 12;
        }
    }

    currentDepth = depth;

    document.querySelectorAll('.mode-btn').forEach(button => {
        button.classList.remove('active');
    });

    btn.classList.add('active');

    if (enginePaused) {
        enginePaused = false;
    }

    analyzePosition();
}

// ======================================
// ENGINE BUTTONS
// ======================================

function createEngineControls() {
    if (document.getElementById('engine-controls')) return;

    const modeButton = document.querySelector('.mode-btn');

    if (!modeButton) return;

    const controls = document.createElement('div');

    controls.id = 'engine-controls';
    controls.className = 'engine-controls';

    controls.style.cssText = `
        display:flex;
        gap:10px;
        width:100%;
        margin-top:12px;
    `;

    controls.innerHTML = `
        <button id="engine-stop" type="button">Stop</button>
        <button id="engine-run" type="button">Run</button>
    `;

    const style = document.createElement('style');

    style.textContent = `
        #engine-controls button {
            flex:1;
            min-height:42px;
            border:0;
            border-radius:9px;
            font-size:14px;
            font-weight:800;
            cursor:pointer;
        }

        #engine-stop {
            background:#c0392b;
            color:white;
        }

        #engine-run {
            background:#81b64c;
            color:#101710;
        }

        #engine-controls button:disabled {
            opacity:.45;
            cursor:not-allowed;
        }
    `;

    document.head.appendChild(style);

    modeButton.parentElement.insertAdjacentElement(
        'afterend',
        controls
    );

    document.getElementById('engine-stop')
        .addEventListener('click', stopEngine);

    document.getElementById('engine-run')
        .addEventListener('click', runEngine);

    updateEngineButtons();
}

function updateEngineButtons() {
    const stopButton = document.getElementById('engine-stop');
    const runButton = document.getElementById('engine-run');

    if (!stopButton || !runButton) return;

    stopButton.disabled = enginePaused || !engineReady;
    runButton.disabled = !enginePaused || !engineReady;
}

function stopEngine() {
    if (enginePaused || !engineReady) return;

    enginePaused = true;
    pendingAnalysis = false;

    analysisVersion++;

    if (searching) {
        stockfish.postMessage('stop');
    }

    bestMoveElement.textContent = 'Engine Stopped';
    pvElement.textContent = 'Analysis paused';

    updateEngineButtons();
}

function runEngine() {
    if (!engineReady || !enginePaused) return;

    enginePaused = false;
    pendingAnalysis = false;

    updateEngineButtons();

    analyzePosition();
}

// ======================================
// BOARD RENDER
// ======================================

function renderBoard() {
    boardElement.innerHTML = '';

    boardElement.style.transform = 'none';
    arrowLayer.style.transform = 'none';

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

            square.className =
                `square ${isLight ? 'light' : 'dark'}`;

            square.dataset.pos = pos;

            square.style.position = 'relative';
            square.style.overflow = 'hidden';

            const piece = game.get(pos);

            if (piece) {
                const pieceElement = document.createElement('span');

                pieceElement.className = 'chess-piece';

                pieceElement.textContent =
                    pieceSymbols[piece.color][piece.type];

                pieceElement.style.cssText = `
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    width:100%;
                    height:100%;
                    position:relative;
                    z-index:2;
                    font-family:"DejaVu Sans","Noto Sans Symbols 2",serif;
                    font-size:clamp(30px, 8vw, 58px);
                    line-height:1;
                    transform:none;
                    pointer-events:none;
                    user-select:none;
                    color:${piece.color === 'w' ? '#ffffff' : '#080808'};
                    text-shadow:${piece.color === 'w'
                        ? '0 1px 2px rgba(0,0,0,.45)'
                        : '0 1px 1px rgba(255,255,255,.15)'};
                `;

                square.appendChild(pieceElement);
            }

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
                    z-index:4;
                    color:${isLight ? '#769656' : '#eeeed2'};
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
                    z-index:4;
                    color:${isLight ? '#769656' : '#eeeed2'};
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
    } else {
        arrowLayer.innerHTML = '';
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

    square.style.boxShadow =
        'inset 0 0 0 4px #facc15';
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
            marker.style.border =
                '5px solid rgba(25,100,45,.65)';
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
// UCI TO SAN
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
            if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
                return;
            }

            const move = temp.move({
                from: uci.substring(0, 2),
                to: uci.substring(2, 4),
                promotion: uci.substring(4, 5) || 'q'
            });

            if (move) result.push(move.san);
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
    if (!uci || uci.length < 4) return;

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
// DRAW BEST MOVE ARROW
// ======================================

function drawArrow(from, to) {
    arrowLayer.innerHTML = '';

    if (!from || !to) return;

    const fromSquare = boardElement.querySelector(
        `[data-pos="${from}"]`
    );

    const toSquare = boardElement.querySelector(
        `[data-pos="${to}"]`
    );

    if (!fromSquare || !toSquare) return;

    const svgRect = arrowLayer.getBoundingClientRect();
    const fromRect = fromSquare.getBoundingClientRect();
    const toRect = toSquare.getBoundingClientRect();

    if (!svgRect.width || !svgRect.height) return;

    const scaleX = 480 / svgRect.width;
    const scaleY = 480 / svgRect.height;

    const x1 = (
        fromRect.left + fromRect.width / 2 - svgRect.left
    ) * scaleX;

    const y1 = (
        fromRect.top + fromRect.height / 2 - svgRect.top
    ) * scaleY;

    const x2 = (
        toRect.left + toRect.width / 2 - svgRect.left
    ) * scaleX;

    const y2 = (
        toRect.top + toRect.height / 2 - svgRect.top
    ) * scaleY;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);

    if (!length) return;

    const ux = dx / length;
    const uy = dy / length;

    const px = -uy;
    const py = ux;

    // Ukuran panah diperkecil

    const shaftWidth = 7;
    const headWidth = 19;
    const headLength = 17;

    const startX = x1 + ux * 10;
    const startY = y1 + uy * 10;

    const tipX = x2 - ux * 7;
    const tipY = y2 - uy * 7;

    const baseX = tipX - ux * headLength;
    const baseY = tipY - uy * headLength;

    const points = [
        [startX + px * shaftWidth / 2, startY + py * shaftWidth / 2],
        [baseX + px * shaftWidth / 2, baseY + py * shaftWidth / 2],
        [baseX + px * headWidth / 2, baseY + py * headWidth / 2],
        [tipX, tipY],
        [baseX - px * headWidth / 2, baseY - py * headWidth / 2],
        [baseX - px * shaftWidth / 2, baseY - py * shaftWidth / 2],
        [startX - px * shaftWidth / 2, startY - py * shaftWidth / 2]
    ];

    const polygon = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'polygon'
    );

    polygon.setAttribute(
        'points',
        points.map(p => p.join(',')).join(' ')
    );

    polygon.setAttribute('fill', '#81b64c');
    polygon.setAttribute('opacity', '0.85');

    arrowLayer.appendChild(polygon);
}

// ======================================
// ENGINE INFO
// ======================================

function handleEngineInfo(line) {
    if (!activeFen) return;

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

    const pvMatch = line.match(/\bpv\s+(.+)$/);

    if (pvMatch) {
        const moves = pvMatch[1].trim().split(/\s+/);
        const firstMove = moves[0];

        if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(firstMove)) {
            displayBestMove(firstMove);
        }

        pvElement.textContent =
            convertPV(pvMatch[1], activeFen) || '-';
    }
}

// ======================================
// ANALYSIS CONTROL
// ======================================

function analyzePosition() {
    if (enginePaused) return;

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
    if (!engineReady || enginePaused) return;

    activeVersion = analysisVersion;
    activeFen = game.fen();

    searching = true;
    pendingAnalysis = false;

    stockfish.postMessage('position fen ' + activeFen);
    stockfish.postMessage('go depth ' + currentDepth);

    updateEngineButtons();
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

    if (lastBestMove) {
        requestAnimationFrame(() => {
            drawArrow(lastBestMove.from, lastBestMove.to);
        });
    }
});

// ======================================
// INITIALIZATION
// ======================================

arrowLayer.style.cssText = `
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    z-index:20;
    pointer-events:none;
    overflow:visible;
`;

createEngineControls();

renderBoard();

evalElement.textContent = '0.00';
bestMoveElement.textContent = 'Waiting for Stockfish...';
pvElement.textContent = 'Waiting for Stockfish...';

// Set Normal sebagai mode awal

const initialMode = document.querySelector('.mode-btn');

if (initialMode) {
    setMode(initialMode);
}
