const boardElement = document.getElementById('board');
const evalElement = document.getElementById('evaluation');
const bestMoveElement = document.getElementById('best-move');
const pvElement = document.getElementById('principal-variation');

const game = new Chess();
let selectedSquare = null;
let stockfish = new Worker('stockfish-19-asm.js');

// Default Mode Ekstrim (Depth 22)
let currentDepth = 22; 

// --- LOGIKA GANTI MODE ---
function setMode(btn) {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDepth = parseInt(btn.getAttribute('data-depth'));
    analyzePosition();
}

// --- SETUP PAPAN ---
function renderBoard() {
    boardElement.innerHTML = '';
    const board = game.board();

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const square = document.createElement('div');
            const isLight = (r + c) % 2 === 0;
            square.className = `square ${isLight ? 'light' : 'dark'}`;
            square.dataset.pos = `${String.fromCharCode(97 + c)}${8 - r}`;

            const piece = board[r][c];
            if (piece) {
                const symbols = { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚', P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔' };
                square.textContent = symbols[piece.color === 'w' ? piece.type.toUpperCase() : piece.type];
                square.style.color = piece.color === 'w' ? '#fff' : '#000';
            }

            square.addEventListener('click', () => handleSquareClick(square));
            boardElement.appendChild(square);
        }
    }
}

// --- INTERAKSI KLIK ---
function handleSquareClick(square) {
    const pos = square.dataset.pos;

    if (selectedSquare) {
        const move = { from: selectedSquare, to: pos, promotion: 'q' };
        const result = game.move(move);

        if (result) {
            selectedSquare = null;
            renderBoard();
            analyzePosition();
        } else {
            selectedSquare = null;
            renderBoard();
        }
    } else {
        const piece = game.get(pos);
        if (piece && piece.color === game.turn()) {
            selectedSquare = pos;
            square.classList.add('selected');
        }
    }
}

// --- ANALISIS STOCKFISH ---
function analyzePosition() {
    const fen = game.fen();
    stockfish.postMessage(`position fen ${fen}`);
    stockfish.postMessage(`go depth ${currentDepth}`);
}

stockfish.onmessage = function(event) {
    const line = event.data;

    if (line.includes('info depth')) {
        const cpMatch = line.match(/score cp (-?\d+)/);
        const mateMatch = line.match(/score mate (-?\d+)/);

        if (cpMatch) {
            const score = parseInt(cpMatch[1]) / 100;
            evalElement.textContent = score.toFixed(2);
        } else if (mateMatch) {
            evalElement.textContent = `M${mateMatch[1]}`;
        }

        const pvMatch = line.match(/ pv (.+)/);
        if (pvMatch) {
            pvElement.textContent = pvMatch[1].split(' ').slice(0, 5).join(' ') + '...';
        }
    }

    if (line.startsWith('bestmove')) {
        const bestMove = line.split(' ')[1];
        bestMoveElement.textContent = bestMove;
    }
};

// --- TOMBOL RESET & FLIP ---
document.getElementById('reset-btn').addEventListener('click', () => {
    game.reset();
    renderBoard();
    evalElement.textContent = '0.00';
    bestMoveElement.textContent = '-';
    pvElement.textContent = '-';
    analyzePosition();
});

document.getElementById('flip-btn').addEventListener('click', () => {
    boardElement.style.transform = boardElement.style.transform === 'rotate(180deg)' ? 'rotate(0deg)' : 'rotate(180deg)';
});

// --- INISIALISASI ---
renderBoard();
analyzePosition();
