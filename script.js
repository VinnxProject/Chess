
// ======================================
// VINNXMATE WELCOME SYSTEM
// ======================================

const welcomePopup = document.getElementById('welcome-popup');
const confirmJoinButton = document.getElementById('confirm-join');

let joinConfirmCount = 0;

const welcomeCompleted =
    localStorage.getItem('vinnxmate_welcome_completed') === 'true';

if (welcomeCompleted) {
    welcomePopup.style.display = 'none';
} else {
    welcomePopup.style.display = 'flex';
}

confirmJoinButton.addEventListener('click', function () {
    joinConfirmCount++;

    if (joinConfirmCount >= 3) {
        localStorage.setItem(
            'vinnxmate_welcome_completed',
            'true'
        );

        welcomePopup.classList.add('hide');

        setTimeout(() => {
            welcomePopup.style.display = 'none';
        }, 350);
    }
});


// ======================================
// INTRO SCREEN
// ======================================

function enterWebsite() {
    const intro = document.getElementById('intro-screen');

    intro.classList.add('hide');

    setTimeout(() => {
        intro.style.display = 'none';
    }, 650);
}


// ======================================
// DOM ELEMENTS
// ======================================

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

let redoHistory = [];

const files = 'abcdefgh';


// ======================================
// GAME REVIEW STATE
// ======================================

let reviewWorker = null;
let reviewReady = false;
let reviewBusy = false;
let reviewCancelled = false;
let reviewDepth = 10;

let reviewResolve = null;
let reviewScore = null;
let reviewBestMove = null;

const reviewResults = [];


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

    if (!Number.isFinite(depth) || depth <= 0) {
        if (
            label.includes('ekstrim') ||
            label.includes('ekstrem') ||
            label.includes('extreme')
        ) {
            depth = 22;
        } else if (
            label.includes('bijak') ||
            label.includes('wise')
        ) {
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

    updateEngineButtons();
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
// UNDO / REDO
// ======================================

function createHistoryControls() {
    if (document.getElementById('move-history-controls')) return;

    const controls = document.createElement('div');

    controls.id = 'move-history-controls';

    controls.style.cssText = `
        display:flex;
        gap:10px;
        width:100%;
        margin-top:12px;
    `;

    controls.innerHTML = `
        <button id="undo-move" type="button">&lt;&lt;</button>
        <button id="redo-move" type="button">&gt;&gt;</button>
    `;

    const style = document.createElement('style');

    style.textContent = `
        #move-history-controls button {
            flex:1;
            min-height:42px;
            border:0;
            border-radius:9px;
            background:#293447;
            color:white;
            font-size:20px;
            font-weight:900;
            cursor:pointer;
        }

        #move-history-controls button:disabled {
            opacity:.35;
            cursor:not-allowed;
        }

        #move-history-controls button:not(:disabled):active {
            transform:scale(.97);
        }
    `;

    document.head.appendChild(style);

    const wrapper = document.querySelector('.board-wrapper');

    if (wrapper) {
        wrapper.insertAdjacentElement('afterend', controls);
    } else {
        boardElement.insertAdjacentElement('afterend', controls);
    }

    document.getElementById('undo-move')
        .addEventListener('click', undoMove);

    document.getElementById('redo-move')
        .addEventListener('click', redoMove);

    updateHistoryButtons();
}

function updateHistoryButtons() {
    const undoButton = document.getElementById('undo-move');
    const redoButton = document.getElementById('redo-move');

    if (!undoButton || !redoButton) return;

    undoButton.disabled = game.history().length === 0;
    redoButton.disabled = redoHistory.length === 0;
}

function undoMove() {
    const move = game.undo();

    if (!move) return;

    redoHistory.push(move);

    selectedSquare = null;
    lastBestMove = null;

    renderBoard();
    updateHistoryButtons();
    clearReviewResults();

    analyzePosition();
}

function redoMove() {
    if (redoHistory.length === 0) return;

    const move = redoHistory.pop();

    const result = game.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion || 'q'
    });

    if (!result) {
        redoHistory = [];
        updateHistoryButtons();
        return;
    }

    selectedSquare = null;
    lastBestMove = null;

    renderBoard();
    updateHistoryButtons();
    clearReviewResults();

    analyzePosition();
}


// ======================================
// GAME REVIEW UI
// ======================================

function createReviewControls() {
    if (document.getElementById('game-review-controls')) return;

    const container = document.createElement('div');

    container.id = 'game-review-controls';

    container.style.cssText = `
        width:100%;
        margin-top:14px;
    `;

    container.innerHTML = `
        <button id="start-game-review" type="button">
            REVIEW GAME
        </button>

        <div id="game-review-status">
            Ready to review
        </div>

        <div id="game-review-summary"></div>
        <div id="game-review-results"></div>
    `;

    const style = document.createElement('style');

    style.textContent = `
        #start-game-review {
            width:100%;
            min-height:45px;
            border:0;
            border-radius:10px;
            background:#81b64c;
            color:#101710;
            font-size:14px;
            font-weight:900;
            cursor:pointer;
        }

        #start-game-review:disabled {
            opacity:.5;
            cursor:not-allowed;
        }

        #game-review-status {
            margin-top:10px;
            color:#9ca3af;
            font-size:12px;
            text-align:center;
        }

        #game-review-summary {
            display:grid;
            grid-template-columns:repeat(2,minmax(0,1fr));
            gap:8px;
            margin-top:12px;
        }

        .review-stat {
            background:#1d293b;
            padding:12px;
            border-radius:9px;
            color:white;
        }

        .review-stat strong {
            display:block;
            font-size:20px;
            margin-bottom:4px;
        }

        .review-stat small {
            color:#9ca3af;
            font-size:11px;
        }

        #game-review-results {
            display:grid;
            gap:8px;
            margin-top:12px;
        }

        .review-move {
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:10px;
            padding:11px 13px;
            background:#1d293b;
            border-radius:9px;
            color:white;
            font-size:13px;
        }

        .review-move-info {
            display:flex;
            flex-direction:column;
            gap:4px;
            min-width:0;
        }

        .review-move-info small {
            color:#8994a5;
        }

        .review-label {
            font-size:11px;
            font-weight:900;
            padding:6px 9px;
            border-radius:6px;
            white-space:nowrap;
        }

        .review-brilliant {
            background:#159b8b;
            color:white;
        }

        .review-great {
            background:#2878c7;
            color:white;
        }

        .review-best {
            background:#81b64c;
            color:#101710;
        }

        .review-excellent {
            background:#579b72;
            color:white;
        }

        .review-good {
            background:#557c9f;
            color:white;
        }

        .review-inaccuracy {
            background:#c49b39;
            color:#17130a;
        }

        .review-mistake {
            background:#d47737;
            color:white;
        }

        .review-blunder {
            background:#c0392b;
            color:white;
        }
    `;

    document.head.appendChild(style);

    const wrapper = document.querySelector('.board-wrapper');

    const historyControls = document.getElementById(
        'move-history-controls'
    );

    if (historyControls) {
        historyControls.insertAdjacentElement('afterend', container);
    } else if (wrapper) {
        wrapper.insertAdjacentElement('afterend', container);
    } else {
        boardElement.insertAdjacentElement('afterend', container);
    }

    document.getElementById('start-game-review')
        .addEventListener('click', startGameReview);
}

function clearReviewResults() {
    const results = document.getElementById('game-review-results');
    const summary = document.getElementById('game-review-summary');
    const status = document.getElementById('game-review-status');

    if (results) results.innerHTML = '';
    if (summary) summary.innerHTML = '';

    if (status && !reviewBusy) {
        status.textContent = 'Ready to review';
    }

    reviewResults.length = 0;
}


// ======================================
// REVIEW ENGINE INITIALIZATION
// ======================================

function initializeReviewWorker() {
    return new Promise((resolve, reject) => {
        if (reviewReady && reviewWorker) {
            resolve();
            return;
        }

        if (reviewWorker) {
            reject(new Error('Review engine is unavailable'));
            return;
        }

        try {
            reviewWorker = new Worker('stockfish-19-asm.js');

            const timeout = setTimeout(() => {
                reject(new Error('Review engine initialization timeout'));
            }, 30000);

            reviewWorker.onerror = error => {
                clearTimeout(timeout);
                reject(error);
            };

            reviewWorker.onmessage = event => {
                const line = String(event.data || '').trim();

                if (line === 'uciok') {
                    reviewWorker.postMessage('isready');
                    return;
                }

                if (line === 'readyok') {
                    clearTimeout(timeout);
                    reviewReady = true;
                    resolve();
                    return;
                }

                if (reviewResolve) {
                    if (line.startsWith('info ')) {
                        const cpMatch = line.match(/score cp (-?\d+)/);
                        const mateMatch = line.match(/score mate (-?\d+)/);

                        if (cpMatch) {
                            reviewScore = Number(cpMatch[1]) / 100;
                        } else if (mateMatch) {
                            const mate = Number(mateMatch[1]);

                            reviewScore = mate > 0
                                ? 1000 - mate
                                : -1000 - mate;
                        }

                        const pvMatch = line.match(
                            /\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/
                        );

                        if (pvMatch) {
                            reviewBestMove = pvMatch[1];
                        }
                    }

                    if (line.startsWith('bestmove')) {
                        const parts = line.split(/\s+/);
                        const bestMove = parts[1];

                        const resolveSearch = reviewResolve;
                        reviewResolve = null;

                        resolveSearch({
                            score: reviewScore,
                            bestMove: bestMove && bestMove !== '(none)'
                                ? bestMove
                                : null
                        });
                    }
                }
            };

            reviewWorker.postMessage('uci');

        } catch (error) {
            reject(error);
        }
    });
}


// ======================================
// REVIEW POSITION
// ======================================

function reviewPosition(fen) {
    return new Promise((resolve, reject) => {
        if (!reviewWorker || !reviewReady) {
            reject(new Error('Review engine not ready'));
            return;
        }

        reviewScore = null;
        reviewBestMove = null;
        reviewResolve = resolve;

        reviewWorker.postMessage('position fen ' + fen);
        reviewWorker.postMessage('go depth ' + reviewDepth);
    });
}


// ======================================
// REVIEW HELPERS
// ======================================

function getWhiteScore(score, fen) {
    const turn = fen.split(' ')[1];

    return turn === 'b' ? -score : score;
}

function getMoveLabel(loss, isBest, move, afterFen) {
    const normalizedLoss = Math.max(0, loss);

    if (isBest) {
        return {
            label: 'Best Move',
            symbol: '★',
            className: 'review-best'
        };
    }

    if (normalizedLoss <= 0.05) {
        return {
            label: 'Great Move',
            symbol: '!',
            className: 'review-great'
        };
    }

    if (normalizedLoss <= 0.25) {
        return {
            label: 'Excellent',
            symbol: '!',
            className: 'review-excellent'
        };
    }

    if (normalizedLoss <= 0.50) {
        return {
            label: 'Good',
            symbol: '✓',
            className: 'review-good'
        };
    }

    if (normalizedLoss <= 1.00) {
        return {
            label: 'Inaccuracy',
            symbol: '?!',
            className: 'review-inaccuracy'
        };
    }

    if (normalizedLoss <= 2.00) {
        return {
            label: 'Mistake',
            symbol: '?',
            className: 'review-mistake'
        };
    }

    return {
        label: 'Blunder',
        symbol: '??',
        className: 'review-blunder'
    };
}

function formatReviewScore(score) {
    if (score === null || !Number.isFinite(score)) {
        return 'N/A';
    }

    return (score > 0 ? '+' : '') + score.toFixed(2);
}

function getReviewPositions() {
    const history = game.history({ verbose: true });
    const temp = new Chess();

    const positions = [{
        fen: temp.fen(),
        move: null,
        moveNumber: 0,
        color: null,
        san: null
    }];

    history.forEach((move, index) => {
        const result = temp.move({
            from: move.from,
            to: move.to,
            promotion: move.promotion || 'q'
        });

        if (!result) return;

        positions.push({
            fen: temp.fen(),
            move: result,
            moveNumber: Math.floor(index / 2) + 1,
            color: result.color,
            san: result.san
        });
    });

    return positions;
}


// ======================================
// START GAME REVIEW
// ======================================

async function startGameReview() {
    const button = document.getElementById('start-game-review');
    const status = document.getElementById('game-review-status');
    const results = document.getElementById('game-review-results');
    const summary = document.getElementById('game-review-summary');

    if (reviewBusy) {
        reviewCancelled = true;

        if (reviewWorker) {
            reviewWorker.postMessage('stop');
        }

        status.textContent = 'Cancelling review...';
        return;
    }

    const history = game.history();

    if (history.length === 0) {
        status.textContent = 'Play some moves before reviewing.';
        return;
    }

    reviewBusy = true;
    reviewCancelled = false;

    button.textContent = 'CANCEL REVIEW';
    results.innerHTML = '';
    summary.innerHTML = '';

    reviewResults.length = 0;

    try {
        status.textContent = 'Starting review engine...';

        await initializeReviewWorker();

        if (reviewCancelled) return;

        const positions = getReviewPositions();

        if (positions.length < 2) {
            status.textContent = 'No moves to review.';
            return;
        }

        const evaluations = [];

        for (let i = 0; i < positions.length; i++) {
            if (reviewCancelled) break;

            status.textContent =
                `Analyzing position ${i + 1}/${positions.length}`;

            const evaluation = await reviewPosition(
                positions[i].fen
            );

            const whiteScore = evaluation.score === null
                ? null
                : getWhiteScore(
                    evaluation.score,
                    positions[i].fen
                );

            evaluations.push({
                whiteScore,
                bestMove: evaluation.bestMove
            });
        }

        if (reviewCancelled) {
            status.textContent = 'Review cancelled.';
            return;
        }

        const counts = {
            'Brilliant': 0,
            'Great Move': 0,
            'Best Move': 0,
            'Excellent': 0,
            'Good': 0,
            'Inaccuracy': 0,
            'Mistake': 0,
            'Blunder': 0
        };

        for (let i = 1; i < positions.length; i++) {
            const before = positions[i - 1];
            const after = positions[i];

            const beforeEval = evaluations[i - 1];
            const afterEval = evaluations[i];

            if (
                beforeEval.whiteScore === null ||
                afterEval.whiteScore === null
            ) continue;

            const mover = after.color;

            const beforeMoverScore = mover === 'w'
                ? beforeEval.whiteScore
                : -beforeEval.whiteScore;

            const afterMoverScore = mover === 'w'
                ? afterEval.whiteScore
                : -afterEval.whiteScore;

            const loss = Math.max(
                0,
                beforeMoverScore - afterMoverScore
            );

            const moveUci =
                after.move.from +
                after.move.to +
                (after.move.promotion || '');

            const isBest =
                beforeEval.bestMove === moveUci;

            const classification = getMoveLabel(
                loss,
                isBest,
                after.move,
                after.fen
            );

            counts[classification.label]++;

            reviewResults.push({
                number: after.moveNumber,
                color: mover,
                san: after.san,
                loss,
                classification
            });
        }

        renderReviewResults(counts);

        status.textContent =
            `Review completed: ${reviewResults.length} moves analyzed.`;

    } catch (error) {
        console.error('Game Review error:', error);
        status.textContent =
            'Review error: ' + (error.message || 'Unknown error');

    } finally {
        reviewBusy = false;
        button.textContent = 'REVIEW GAME';
    }
}


// ======================================
// RENDER REVIEW RESULTS
// ======================================

function renderReviewResults(counts) {
    const results = document.getElementById('game-review-results');
    const summary = document.getElementById('game-review-summary');

    results.innerHTML = '';
    summary.innerHTML = '';

    const importantLabels = [
        'Brilliant',
        'Great Move',
        'Best Move',
        'Excellent',
        'Good',
        'Inaccuracy',
        'Mistake',
        'Blunder'
    ];

    importantLabels.forEach(label => {
        const stat = document.createElement('div');

        stat.className = 'review-stat';

        stat.innerHTML = `
            <strong>${counts[label] || 0}</strong>
            <small>${label}</small>
        `;

        summary.appendChild(stat);
    });

    reviewResults.forEach(item => {
        const row = document.createElement('div');

        row.className = 'review-move';

        const colorName = item.color === 'w'
            ? 'White'
            : 'Black';

        row.innerHTML = `
            <div class="review-move-info">
                <strong>
                    ${item.number}${item.color === 'b' ? '...' : '.'}
                    ${item.san}
                </strong>
                <small>
                    ${colorName} · Loss: ${item.loss.toFixed(2)}
                </small>
            </div>

            <span class="review-label ${item.classification.className}">
                ${item.classification.symbol}
                ${item.classification.label}
            </span>
        `;

        results.appendChild(row);
    });
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
                redoHistory = [];

                selectedSquare = null;
                lastBestMove = null;

                renderBoard();
                updateHistoryButtons();
                clearReviewResults();

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

    redoHistory = [];

    selectedSquare = null;
    lastBestMove = null;

    evalElement.textContent = '0.00';
    bestMoveElement.textContent = enginePaused
        ? 'Engine Stopped'
        : 'Analyzing...';

    pvElement.textContent = enginePaused
        ? 'Analysis paused'
        : 'Calculating...';

    arrowLayer.innerHTML = '';

    renderBoard();
    updateHistoryButtons();
    clearReviewResults();

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
createHistoryControls();
createReviewControls();

renderBoard();

updateHistoryButtons();

evalElement.textContent = '0.00';
bestMoveElement.textContent = 'Waiting for Stockfish...';
pvElement.textContent = 'Waiting for Stockfish...';

const initialMode = document.querySelector('.mode-btn');

if (initialMode) {
    setMode(initialMode);
}
