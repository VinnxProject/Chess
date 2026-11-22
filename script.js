// ======================================
// VINNXMATE WELCOME SYSTEM
// ======================================

const welcomePopup = document.getElementById('welcome-popup');
const confirmJoinButton = document.getElementById('confirm-join');

let joinConfirmCount = 0;

const welcomeCompleted =
    localStorage.getItem('vinnxmate_welcome_completed') === 'true';

if (welcomePopup) {
    welcomePopup.style.display = welcomeCompleted ? 'none' : 'flex';
}

if (confirmJoinButton) {
    confirmJoinButton.addEventListener('click', function () {
        joinConfirmCount++;

        if (joinConfirmCount >= 3) {
            localStorage.setItem('vinnxmate_welcome_completed', 'true');

            welcomePopup.classList.add('hide');

            setTimeout(() => {
                welcomePopup.style.display = 'none';
            }, 350);
        }
    });
}

// INTRO SCREEN
function enterWebsite() {
    const intro = document.getElementById('intro-screen');

    if (!intro) return;

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

// LIVE MOVE ANALYSIS
let liveReviewQueue = [];
let liveMoveEntries = [];
let liveReviewProcessing = false;
let liveQueueWaiters = [];

// ======================================
// PIECE SYMBOLS
// ======================================

const pieceSymbols = {
    w: {
        p: '♙',
        r: '♖',
        n: '♘',
        b: '♗',
        q: '♕',
        k: '♔'
    },
    b: {
        p: '♟',
        r: '♜',
        n: '♞',
        b: '♝',
        q: '♛',
        k: '♚'
    }
};

// ======================================
// ENGINE INITIALIZATION
// ======================================

try {
    stockfish = new Worker('stockfish-19-asm.js');

    stockfish.onmessage = function (event) {
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
            if (enginePaused || activeVersion !== analysisVersion) {
                return;
            }

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

    stockfish.onerror = function (error) {
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
    document.querySelectorAll('.mode-btn').forEach(button => {
        button.classList.remove('active');
    });

    btn.classList.add('active');

    const modeText = (
        btn.dataset.depth ||
        btn.textContent ||
        ''
    ).toLowerCase();

    if (modeText.includes('high')) {
        currentDepth = 22;
    } else if (modeText.includes('medium')) {
        currentDepth = 18;
    } else {
        currentDepth = 12;
    }

    analyzePosition();
}

// ======================================
// ENGINE CONTROL BUTTONS
// ======================================

function createEngineControls() {
    const container = document.getElementById('engine-controls');

    if (!container) return;

    container.innerHTML = `
        <button id="engine-stop" type="button">Engine Stop</button>
        <button id="engine-run" type="button">Engine Run</button>
    `;

    document
        .getElementById('engine-stop')
        .addEventListener('click', stopEngine);

    document
        .getElementById('engine-run')
        .addEventListener('click', runEngine);

    updateEngineButtons();
}

function updateEngineButtons() {
    const stopButton = document.getElementById('engine-stop');
    const runButton = document.getElementById('engine-run');

    if (stopButton) {
        stopButton.disabled = enginePaused;
    }

    if (runButton) {
        runButton.disabled = !enginePaused;
    }
}

function stopEngine() {
    enginePaused = true;
    analysisVersion++;

    if (stockfish) {
        stockfish.postMessage('stop');
    }

    searching = false;

    updateEngineButtons();
}

function runEngine() {
    enginePaused = false;

    updateEngineButtons();
    analyzePosition();
}

// ======================================
// MOVE HISTORY CONTROLS
// ======================================

function createHistoryControls() {
    const container = document.getElementById('history-controls');

    if (!container) return;

    container.innerHTML = `
        <button id="undo-move" type="button">←</button>
        <button id="redo-move" type="button">→</button>
    `;

    document
        .getElementById('undo-move')
        .addEventListener('click', undoMove);

    document
        .getElementById('redo-move')
        .addEventListener('click', redoMove);
}

function updateHistoryButtons() {
    const undoButton = document.getElementById('undo-move');
    const redoButton = document.getElementById('redo-move');

    if (undoButton) {
        undoButton.disabled = game.history().length === 0;
    }

    if (redoButton) {
        redoButton.disabled = redoHistory.length === 0;
    }
}

function undoMove() {
    const undone = game.undo();

    if (!undone) return;

    redoHistory.push(undone);

    selectedSquare = null;
    lastBestMove = null;

    const entry = liveMoveEntries.pop();

    if (entry) {
        liveReviewQueue = liveReviewQueue.filter(
            task => task.entry !== entry
        );
    }

    renderBoard();
    updateHistoryButtons();
    clearReviewResults();
    analyzePosition();
}

function redoMove() {
    if (redoHistory.length === 0) return;

    const move = redoHistory.pop();

    const beforeFen = game.fen();

    const result = game.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion || 'q'
    });

    if (!result) return;

    const afterFen = game.fen();

    registerLiveMove(result, beforeFen, afterFen);

    selectedSquare = null;
    lastBestMove = null;

    renderBoard();
    updateHistoryButtons();
    clearReviewResults();
    analyzePosition();
}
// ======================================
// GAME REVIEW CONTROLS
// ======================================

function createReviewControls() {
    const container = document.getElementById('review-controls');

    if (!container) return;

    container.innerHTML = `
        <button id="start-review" type="button">Game Review</button>
        <button id="cancel-review" type="button" disabled>Cancel Review</button>
        <div id="review-status">Ready to review</div>
        <div id="review-summary"></div>
        <div id="review-results"></div>
    `;

    document
        .getElementById('start-review')
        .addEventListener('click', startGameReview);

    document
        .getElementById('cancel-review')
        .addEventListener('click', () => {
            reviewCancelled = true;

            if (reviewWorker) {
                reviewWorker.postMessage('stop');
            }
        });
}

function clearReviewResults() {
    reviewResults.length = 0;

    const summary = document.getElementById('review-summary');
    const results = document.getElementById('review-results');
    const status = document.getElementById('review-status');

    if (summary) summary.innerHTML = '';
    if (results) results.innerHTML = '';
    if (status) status.textContent = 'Ready to review';
}

// ======================================
// REVIEW ENGINE INITIALIZATION
// ======================================

function initializeReviewWorker() {
    if (reviewWorker) return;

    try {
        reviewWorker = new Worker('stockfish-19-asm.js');

        reviewWorker.onmessage = function (event) {
            const line = String(event.data || '').trim();

            if (line === 'uciok') {
                reviewWorker.postMessage('isready');
                return;
            }

            if (line === 'readyok') {
                reviewReady = true;
                processLiveReviewQueue();
                return;
            }

            if (line.startsWith('info depth')) {
                const cpMatch = line.match(/\bscore cp (-?\d+)/);
                const mateMatch = line.match(/\bscore mate (-?\d+)/);
                const pvMatch = line.match(/\bpv (.+)$/);

                if (cpMatch) {
                    reviewScore = {
                        type: 'cp',
                        value: Number(cpMatch[1])
                    };
                } else if (mateMatch) {
                    reviewScore = {
                        type: 'mate',
                        value: Number(mateMatch[1])
                    };
                }

                if (pvMatch) {
                    reviewBestMove = pvMatch[1].trim().split(/\s+/)[0];
                }

                return;
            }

            if (line.startsWith('bestmove')) {
                const parts = line.split(/\s+/);
                const bestMove = parts[1];

                if (reviewResolve) {
                    const resolve = reviewResolve;
                    reviewResolve = null;

                    resolve({
                        score: reviewScore,
                        bestMove:
                            bestMove && bestMove !== '(none)'
                                ? bestMove
                                : reviewBestMove
                    });
                }
            }
        };

        reviewWorker.onerror = function (error) {
            console.error('Review engine error:', error);

            reviewReady = false;

            if (reviewResolve) {
                const resolve = reviewResolve;
                reviewResolve = null;
                resolve(null);
            }
        };

        reviewWorker.postMessage('uci');

    } catch (error) {
        console.error('Review worker unavailable:', error);
    }
}

// ======================================
// REVIEW POSITION
// ======================================

function reviewPosition(fen) {
    return new Promise(resolve => {
        if (!reviewWorker || !reviewReady || reviewResolve) {
            resolve(null);
            return;
        }

        reviewScore = null;
        reviewBestMove = null;
        reviewResolve = resolve;

        reviewWorker.postMessage(`position fen ${fen}`);
        reviewWorker.postMessage(`go depth ${reviewDepth}`);
    });
}

// ======================================
// SCORE UTILITIES
// ======================================

function getWhiteScore(score, fen) {
    if (!score) return null;

    const turn = fen.split(' ')[1];

    if (score.type === 'mate') {
        const value = score.value > 0 ? 1000 : -1000;

        return turn === 'w' ? value : -value;
    }

    const value = score.value / 100;

    return turn === 'w' ? value : -value;
}

function getMoveLabel(loss, isBest) {
    if (isBest) return 'Best Move';

    if (loss <= 0.05) return 'Great Move';
    if (loss <= 0.25) return 'Excellent';
    if (loss <= 0.50) return 'Good';
    if (loss <= 1.00) return 'Inaccuracy';
    if (loss <= 2.00) return 'Mistake';

    return 'Blunder';
}

function formatReviewScore(score) {
    if (!score) return 'N/A';

    if (score.type === 'mate') {
        return `M${Math.abs(score.value)}`;
    }

    const value = score.value / 100;

    return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

// ======================================
// MOVE POSITION COLLECTION
// ======================================

function getReviewPositions() {
    const history = game.history({ verbose: true });

    const tempGame = new Chess();
    const positions = [];

    for (const move of history) {
        const beforeFen = tempGame.fen();

        const playedMove = tempGame.move({
            from: move.from,
            to: move.to,
            promotion: move.promotion || 'q'
        });

        if (!playedMove) continue;

        positions.push({
            moveNumber: Math.ceil(positions.length / 2) + 1,
            color: move.color,
            san: playedMove.san,
            from: move.from,
            to: move.to,
            beforeFen,
            afterFen: tempGame.fen()
        });
    }

    return positions;
}

// ======================================
// LIVE MOVE CLASSIFICATION UI
// ======================================

function createLiveMovePanel() {
    let panel = document.getElementById('live-move-panel');

    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'live-move-panel';

    panel.innerHTML = `
        <div class="live-panel-heading">
            Move Analysis
        </div>
        <div id="live-move-list">
            <div class="live-empty">
                Make a move to see its classification.
            </div>
        </div>
    `;

    const parent =
        document.getElementById('review-controls') ||
        boardElement.parentElement;

    parent.appendChild(panel);

    return panel;
}

function renderLiveMoveEntries() {
    const panel = createLiveMovePanel();
    const list = panel.querySelector('#live-move-list');

    if (!list) return;

    if (liveMoveEntries.length === 0) {
        list.innerHTML = `
            <div class="live-empty">
                Make a move to see its classification.
            </div>
        `;

        return;
    }

    list.innerHTML = liveMoveEntries
        .slice()
        .reverse()
        .map(entry => {
            const colorName =
                entry.color === 'w' ? 'White' : 'Black';

            const label = entry.label || 'Analyzing...';

            return `
                <div class="live-move-item">
                    <div class="live-move-info">
                        <strong>${colorName} ${entry.moveNumber}.</strong>
                        <span>${entry.san}</span>
                    </div>
                    <span class="move-classification ${label
                        .toLowerCase()
                        .replace(/\s+/g, '-')}">
                        ${label}
                    </span>
                </div>
            `;
        })
        .join('');
}

// ======================================
// REGISTER LIVE MOVE
// ======================================

function registerLiveMove(move, beforeFen, afterFen) {
    const entry = {
        moveNumber: Math.ceil(game.history().length / 2),
        color: move.color,
        san: move.san,
        from: move.from,
        to: move.to,
        beforeFen,
        afterFen,
        label: null
    };

    liveMoveEntries.push(entry);

    liveReviewQueue.push({ entry });

    renderLiveMoveEntries();
    processLiveReviewQueue();
}

// ======================================
// LIVE REVIEW QUEUE
// ======================================

function processLiveReviewQueue() {
    if (
        liveReviewProcessing ||
        reviewBusy ||
        !reviewReady ||
        !reviewWorker
    ) {
        return;
    }

    liveReviewProcessing = true;

    runLiveReviewQueue();
}

async function runLiveReviewQueue() {
    while (
        liveReviewQueue.length > 0 &&
        !reviewBusy
    ) {
        const task = liveReviewQueue.shift();
        const entry = task.entry;

        if (!liveMoveEntries.includes(entry)) {
            continue;
        }

        const beforeResult = await reviewPosition(entry.beforeFen);

        if (!beforeResult || !liveMoveEntries.includes(entry)) {
            continue;
        }

        const afterResult = await reviewPosition(entry.afterFen);

        if (!afterResult || !liveMoveEntries.includes(entry)) {
            continue;
        }

        const beforeScore = getWhiteScore(
            beforeResult.score,
            entry.beforeFen
        );

        const afterScore = getWhiteScore(
            afterResult.score,
            entry.afterFen
        );

        if (beforeScore === null || afterScore === null) {
            entry.label = 'Analysis unavailable';
            renderLiveMoveEntries();
            continue;
        }

        const moverSign = entry.color === 'w' ? 1 : -1;

        const beforeMoverScore = beforeScore * moverSign;
        const afterMoverScore = afterScore * moverSign;

        const loss = Math.max(
            0,
            beforeMoverScore - afterMoverScore
        );

        const isBest =
            beforeResult.bestMove &&
            beforeResult.bestMove ===
                `${entry.from}${entry.to}`;

        entry.label = getMoveLabel(loss, isBest);

        renderLiveMoveEntries();
    }

    liveReviewProcessing = false;

    const waiters = liveQueueWaiters.splice(0);

    waiters.forEach(resolve => resolve());

    if (liveReviewQueue.length > 0 && !reviewBusy) {
        processLiveReviewQueue();
    }
}

function waitForLiveQueue() {
    if (
        liveReviewQueue.length === 0 &&
        !liveReviewProcessing
    ) {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        liveQueueWaiters.push(resolve);
    });
}
// ======================================
// GAME REVIEW
// ======================================

async function startGameReview() {
    if (reviewBusy) return;

    initializeReviewWorker();

    if (!reviewReady) {
        const status = document.getElementById('review-status');
        if (status) status.textContent = 'Review engine is not ready.';
        return;
    }

    await waitForLiveQueue();

    if (reviewBusy) return;

    const positions = getReviewPositions();

    if (positions.length === 0) {
        const status = document.getElementById('review-status');
        if (status) status.textContent = 'No moves to review.';
        return;
    }

    reviewBusy = true;
    reviewCancelled = false;
    reviewResults.length = 0;

    const startButton = document.getElementById('start-review');
    const cancelButton = document.getElementById('cancel-review');
    const status = document.getElementById('review-status');
    const summary = document.getElementById('review-summary');
    const results = document.getElementById('review-results');

    startButton.disabled = true;
    cancelButton.disabled = false;

    summary.innerHTML = '';
    results.innerHTML = '';

    for (let i = 0; i < positions.length; i++) {
        if (reviewCancelled) break;

        const position = positions[i];

        if (status) {
            status.textContent =
                `Analyzing move ${i + 1} / ${positions.length}...`;
        }

        const beforeResult = await reviewPosition(position.beforeFen);

        if (reviewCancelled || !beforeResult) break;

        const afterResult = await reviewPosition(position.afterFen);

        if (reviewCancelled || !afterResult) break;

        const beforeScore = getWhiteScore(
            beforeResult.score,
            position.beforeFen
        );

        const afterScore = getWhiteScore(
            afterResult.score,
            position.afterFen
        );

        if (beforeScore === null || afterScore === null) {
            continue;
        }

        const moverSign = position.color === 'w' ? 1 : -1;

        const loss = Math.max(
            0,
            beforeScore * moverSign - afterScore * moverSign
        );

        const bestMove = beforeResult.bestMove || '';

        const isBest =
            bestMove === `${position.from}${position.to}`;

        const label = getMoveLabel(loss, isBest);

        reviewResults.push({
            ...position,
            loss,
            label,
            beforeScore,
            afterScore,
            bestMove
        });

        renderReviewResults();
    }

    reviewBusy = false;

    startButton.disabled = false;
    cancelButton.disabled = true;

    if (status) {
        status.textContent = reviewCancelled
            ? 'Review cancelled.'
            : 'Review completed.';
    }

    processLiveReviewQueue();
}

// ======================================
// REVIEW RESULTS
// ======================================

function renderReviewResults() {
    const results = document.getElementById('review-results');
    const summary = document.getElementById('review-summary');

    if (!results || !summary) return;

    const counts = {
        'Best Move': 0,
        'Great Move': 0,
        'Excellent': 0,
        'Good': 0,
        'Inaccuracy': 0,
        'Mistake': 0,
        'Blunder': 0
    };

    reviewResults.forEach(result => {
        if (counts[result.label] !== undefined) {
            counts[result.label]++;
        }
    });

    summary.innerHTML = `
        <div class="review-stat-grid">
            ${Object.entries(counts).map(([label, count]) => `
                <div class="review-stat">
                    <strong>${count}</strong>
                    <span>${label}</span>
                </div>
            `).join('')}
        </div>
    `;

    results.innerHTML = reviewResults.map(result => `
        <div class="review-move">
            <div>
                <strong>
                    ${result.moveNumber}.
                    ${result.color === 'w' ? 'White' : 'Black'}
                </strong>
                <span>${result.san}</span>
            </div>

            <div>
                <strong class="move-classification ${
                    result.label.toLowerCase().replace(/\s+/g, '-')
                }">
                    ${result.label}
                </strong>
                <span>
                    Loss: ${result.loss.toFixed(2)}
                </span>
            </div>
        </div>
    `).join('');
}

// ======================================
// CHESS BOARD
// ======================================

function renderBoard() {
    if (!boardElement) return;

    boardElement.innerHTML = '';

    const board = game.board();

    const rows = flipped
        ? [...board].reverse().map(row => [...row].reverse())
        : board;

    rows.forEach((row, rowIndex) => {
        row.forEach((piece, colIndex) => {
            const square = document.createElement('div');

            const actualRow = flipped ? 7 - rowIndex : rowIndex;
            const actualCol = flipped ? 7 - colIndex : colIndex;

            const squareName =
                files[actualCol] + (8 - actualRow);

            square.className =
                `square ${(actualRow + actualCol) % 2 === 0
                    ? 'light'
                    : 'dark'}`;

            square.dataset.pos = squareName;

            if (piece) {
                const pieceElement = document.createElement('span');

                pieceElement.className =
                    `piece ${piece.color === 'w' ? 'white' : 'black'}`;

                pieceElement.textContent =
                    pieceSymbols[piece.color][piece.type];

                square.appendChild(pieceElement);
            }

            if (selectedSquare === squareName) {
                square.classList.add('selected');
            }

            if (actualRow === (flipped ? 0 : 7)) {
                const fileLabel = document.createElement('span');
                fileLabel.className = 'coordinate file-coordinate';
                fileLabel.textContent = files[actualCol];
                square.appendChild(fileLabel);
            }

            if (actualCol === (flipped ? 7 : 0)) {
                const rankLabel = document.createElement('span');
                rankLabel.className = 'coordinate rank-coordinate';
                rankLabel.textContent = 8 - actualRow;
                square.appendChild(rankLabel);
            }

            square.addEventListener('click', () => {
                handleSquareClick(square);
            });

            boardElement.appendChild(square);
        });
    });

    highlightSelected();
    showLegalMoves();
    drawArrow();
}

// ======================================
// SELECTED SQUARE
// ======================================

function highlightSelected() {
    if (!selectedSquare) return;

    const selected = boardElement.querySelector(
        `[data-pos="${selectedSquare}"]`
    );

    if (selected) {
        selected.classList.add('selected');
    }
}

// ======================================
// LEGAL MOVE INDICATORS
// ======================================

function showLegalMoves() {
    if (!selectedSquare) return;

    const moves = game.moves({
        square: selectedSquare,
        verbose: true
    });

    moves.forEach(move => {
        const square = boardElement.querySelector(
            `[data-pos="${move.to}"]`
        );

        if (!square) return;

        const indicator = document.createElement('span');

        indicator.className = game.get(move.to)
            ? 'legal-capture'
            : 'legal-dot';

        square.appendChild(indicator);
    });
}

// ======================================
// HANDLE BOARD CLICK
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
            const beforeFen = game.fen();

            const result = game.move({
                from: selectedSquare,
                to: pos,
                promotion: 'q'
            });

            if (result) {
                const afterFen = game.fen();

                redoHistory = [];

                registerLiveMove(result, beforeFen, afterFen);

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

function uciToSan(uci) {
    if (!uci || uci.length < 4) return uci;

    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci[4] || 'q';

    const tempGame = new Chess(game.fen());

    const move = tempGame.move({
        from,
        to,
        promotion
    });

    return move ? move.san : uci;
}

// ======================================
// CONVERT PRINCIPAL VARIATION
// ======================================

function convertPV(pv) {
    if (!pv) return '-';

    const tempGame = new Chess(game.fen());

    const moves = pv.trim().split(/\s+/);
    const sanMoves = [];

    for (const uci of moves) {
        if (!uci || uci.length < 4) break;

        const move = tempGame.move({
            from: uci.slice(0, 2),
            to: uci.slice(2, 4),
            promotion: uci[4] || 'q'
        });

        if (!move) break;

        sanMoves.push(move.san);
    }

    return sanMoves.join(' ') || '-';
}

// ======================================
// BEST MOVE DISPLAY
// ======================================

function displayBestMove(uci) {
    lastBestMove = uci;

    bestMoveElement.textContent = uciToSan(uci);

    drawArrow();
}

// ======================================
// ENGINE ARROW
// ======================================

function drawArrow() {
    if (!arrowLayer) return;

    arrowLayer.innerHTML = '';

    if (!lastBestMove) return;

    const from = lastBestMove.slice(0, 2);
    const to = lastBestMove.slice(2, 4);

    const fromSquare = boardElement.querySelector(
        `[data-pos="${from}"]`
    );

    const toSquare = boardElement.querySelector(
        `[data-pos="${to}"]`
    );

    if (!fromSquare || !toSquare) return;

    const boardRect = boardElement.getBoundingClientRect();
    const fromRect = fromSquare.getBoundingClientRect();
    const toRect = toSquare.getBoundingClientRect();

    const startX =
        fromRect.left + fromRect.width / 2 - boardRect.left;

    const startY =
        fromRect.top + fromRect.height / 2 - boardRect.top;

    const endX =
        toRect.left + toRect.width / 2 - boardRect.left;

    const endY =
        toRect.top + toRect.height / 2 - boardRect.top;

    const svgNS = 'http://www.w3.org/2000/svg';

    const svg = document.createElementNS(svgNS, 'svg');

    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);

    const defs = document.createElementNS(svgNS, 'defs');
    const marker = document.createElementNS(svgNS, 'marker');

    marker.setAttribute('id', 'arrow-head');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '5');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');

    const arrowHead = document.createElementNS(svgNS, 'path');

    arrowHead.setAttribute('d', 'M0,0 L0,6 L6,3 z');
    arrowHead.setAttribute('fill', '#28d17c');

    marker.appendChild(arrowHead);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const line = document.createElementNS(svgNS, 'line');

    line.setAttribute('x1', startX);
    line.setAttribute('y1', startY);
    line.setAttribute('x2', endX);
    line.setAttribute('y2', endY);
    line.setAttribute('stroke', '#28d17c');
    line.setAttribute('stroke-width', '5');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', 'url(#arrow-head)');
    line.setAttribute('opacity', '0.85');

    svg.appendChild(line);
    arrowLayer.appendChild(svg);
}

// ======================================
// ENGINE INFORMATION
// ======================================

function handleEngineInfo(line) {
    const cpMatch = line.match(/\bscore cp (-?\d+)/);
    const mateMatch = line.match(/\bscore mate (-?\d+)/);
    const pvMatch = line.match(/\bpv (.+)$/);

    if (cpMatch) {
        const score = Number(cpMatch[1]) / 100;

        evalElement.textContent =
            `${score > 0 ? '+' : ''}${score.toFixed(2)}`;
    }

    if (mateMatch) {
        evalElement.textContent = `M${mateMatch[1]}`;
    }

    if (pvMatch) {
        pvElement.textContent = convertPV(pvMatch[1]);
    }
}

// ======================================
// ENGINE ANALYSIS
// ======================================

function analyzePosition() {
    if (!stockfish || !engineReady || enginePaused) {
        return;
    }

    analysisVersion++;

    if (searching) {
        pendingAnalysis = true;
        stockfish.postMessage('stop');
        return;
    }

    startAnalysis();
}

function startAnalysis() {
    if (
        !stockfish ||
        !engineReady ||
        enginePaused ||
        searching
    ) {
        return;
    }

    activeVersion = analysisVersion;
    activeFen = game.fen();

    searching = true;

    stockfish.postMessage(`position fen ${activeFen}`);
    stockfish.postMessage(`go depth ${currentDepth}`);

    updateEngineButtons();
}

// ======================================
// RESET GAME
// ======================================

const resetButton = document.getElementById('reset-game');

if (resetButton) {
    resetButton.addEventListener('click', () => {
        game.reset();

        redoHistory = [];
        liveReviewQueue = [];
        liveMoveEntries = [];

        selectedSquare = null;
        lastBestMove = null;

        evalElement.textContent = '0.00';
        bestMoveElement.textContent = 'Waiting for Stockfish...';
        pvElement.textContent = 'Waiting for Stockfish...';

        renderBoard();
        updateHistoryButtons();
        renderLiveMoveEntries();
        clearReviewResults();
        analyzePosition();
    });
}

// ======================================
// FLIP BOARD
// ======================================

const flipButton = document.getElementById('flip-board');

if (flipButton) {
    flipButton.addEventListener('click', () => {
        flipped = !flipped;
        renderBoard();
    });
}

// ======================================
// INITIALIZATION
// ======================================

if (arrowLayer) {
    arrowLayer.style.cssText = `
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        z-index: 20;
        pointer-events: none;
        overflow: visible;
    `;
}

createEngineControls();
createHistoryControls();
createReviewControls();
createLiveMovePanel();

renderBoard();
updateHistoryButtons();

evalElement.textContent = '0.00';
bestMoveElement.textContent = 'Waiting for Stockfish...';
pvElement.textContent = 'Waiting for Stockfish...';

initializeReviewWorker();

const initialMode = document.querySelector('.mode-btn');

if (initialMode) {
    setMode(initialMode);
        }
