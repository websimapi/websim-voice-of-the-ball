import { Peer } from "peerjs";
import QRCode from "qrcode";
import { AudioController } from "./audio.js";
import { SensorController } from "./sensors.js";

// Game Constants
const GAME_STATE = {
    MENU: 'MENU',
    WAITING_FOR_OPPONENT: 'WAITING_FOR_OPPONENT',
    IDLE: 'IDLE', // Game connected, waiting for serve
    SERVING: 'SERVING', // It is my turn to serve
    INCOMING: 'INCOMING', // Ball is coming towards me
    OUTGOING: 'OUTGOING', // Ball is moving away from me
    GAME_OVER: 'GAME_OVER'
};

const audio = new AudioController();
const sensors = new SensorController();
let peer;
let conn;

// Game Variables
let state = GAME_STATE.MENU;
let isHost = false;
let myScore = 0;
let oppScore = 0;
let incomingBallTimer = null;
let flightDuration = 2000; // ms
let ballStartTime = 0;
let animationFrameId;

// DOM Elements
const screens = {
    intro: document.getElementById('intro-screen'),
    connect: document.getElementById('connect-screen'),
    game: document.getElementById('game-screen')
};

const ui = {
    message: document.getElementById('game-message'),
    scoreMe: document.getElementById('score-me'),
    scoreOpp: document.getElementById('score-opp'),
    ball: document.getElementById('ball-indicator'),
    connectionStatus: document.getElementById('connection-status')
};

// --- Initialization ---

document.getElementById('start-btn').addEventListener('click', async () => {
    const granted = await sensors.requestPermission();
    if (granted) {
        await audio.load();
        audio.play('hit', 0.5); // Test sound
        showScreen('connect');
        initNetwork();
    }
});

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
}

// --- Network Logic ---

function initNetwork() {
    peer = new Peer();

    peer.on('open', (id) => {
        // Prepare Host UI
        const link = `${window.location.origin}${window.location.pathname}?join=${id}`;
        document.getElementById('my-id-display').textContent = `ID: ${id}`;
        
        QRCode.toCanvas(id, { width: 150 }, function (err, canvas) {
            const container = document.getElementById('qrcode');
            container.innerHTML = '';
            container.appendChild(canvas);
        });

        document.getElementById('copy-link-btn').onclick = () => {
            navigator.clipboard.writeText(link);
            alert('Link copied!');
        };

        // Check for Auto-Join
        const urlParams = new URLSearchParams(window.location.search);
        const joinId = urlParams.get('join');
        if (joinId) {
            connectToPeer(joinId);
        }
    });

    peer.on('connection', (connection) => {
        // I am Host, someone connected
        conn = connection;
        isHost = true;
        setupConnectionHandlers();
        ui.connectionStatus.textContent = "Opponent connected!";
        setTimeout(startGame, 1000);
    });
}

document.getElementById('join-btn').addEventListener('click', () => {
    const id = document.getElementById('join-id-input').value;
    if (id) connectToPeer(id);
});

function connectToPeer(id) {
    ui.connectionStatus.textContent = "Connecting...";
    conn = peer.connect(id);
    isHost = false;
    setupConnectionHandlers();
}

function setupConnectionHandlers() {
    conn.on('open', () => {
        ui.connectionStatus.textContent = "Connected!";
        if (!isHost) startGame(); // Client starts game immediately on open
    });

    conn.on('data', (data) => {
        handleNetworkData(data);
    });

    conn.on('close', () => {
        alert("Opponent disconnected");
        resetGame();
    });
}

function sendData(type, payload) {
    if (conn && conn.open) {
        conn.send({ type, payload });
    }
}

// --- Game Logic ---

function startGame() {
    showScreen('game');
    sensors.start(handleSwing);
    audio.startDrone();
    
    // Reset scores
    myScore = 0;
    oppScore = 0;
    updateScoreUI();

    if (isHost) {
        setGameState(GAME_STATE.SERVING);
    } else {
        setGameState(GAME_STATE.IDLE);
    }
}

function resetGame() {
    location.reload();
}

function setGameState(newState) {
    state = newState;
    screens.game.className = 'screen active'; // reset classes

    switch (state) {
        case GAME_STATE.SERVING:
            ui.message.textContent = "YOUR SERVE";
            screens.game.classList.add('state-serve');
            ui.ball.style.opacity = '1';
            ui.ball.style.transform = 'scale(1)';
            break;
        case GAME_STATE.IDLE:
            ui.message.textContent = "OPPONENT SERVING";
            ui.ball.style.opacity = '0';
            break;
        case GAME_STATE.INCOMING:
            ui.message.textContent = "INCOMING!";
            screens.game.classList.add('state-incoming');
            break;
        case GAME_STATE.OUTGOING:
            ui.message.textContent = "BALL IN FLIGHT";
            ui.ball.style.opacity = '0';
            break;
    }
}

function handleNetworkData(data) {
    switch (data.type) {
        case 'BALL_SERVED':
        case 'BALL_RETURNED':
            handleIncomingBall(data.payload.duration);
            break;
        case 'POINT_SCORED':
            // Opponent scored
            oppScore++;
            updateScoreUI();
            audio.play('miss'); // I missed, sad sound
            setGameState(GAME_STATE.SERVING); // Loser serves
            break;
    }
}

function handleSwing(force) {
    if (state === GAME_STATE.SERVING) {
        // Serve logic
        audio.play('hit', 1.0, 1.0 + (force / 50));
        sendBall(force);
    } else if (state === GAME_STATE.INCOMING) {
        // Return logic
        const now = Date.now();
        const timeElapsed = now - ballStartTime;
        const timeRemaining = flightDuration - timeElapsed;

        // "Catch" window: e.g., last 500ms of flight
        const hitWindow = 600; 

        if (Math.abs(timeRemaining) < hitWindow) {
            // Good hit
            clearTimeout(incomingBallTimer);
            audio.play('hit', 1.0, 1.0 + (force / 50));
            if (navigator.vibrate) navigator.vibrate(100);
            sendBall(force);
        } else {
            // Too early
            audio.play('miss');
            // Don't change state, might get another swing? 
            // Or penalize? Let's treat early swing as a miss/foul implicitly by doing nothing
            // Actually, usually in these games early swing = miss.
            // But for forgiveness, we'll just play miss sound.
        }
    }
}

function sendBall(force) {
    // Calculate flight time based on force (stronger = faster)
    // Force is approx 15 to 50
    const speedFactor = Math.min(Math.max(force, 15), 60);
    // Map 15->60 to 3000ms->1000ms
    const duration = 3000 - ((speedFactor - 15) * 40); // crude map

    setGameState(GAME_STATE.OUTGOING);
    sendData('BALL_RETURNED', { duration });
}

function handleIncomingBall(duration) {
    setGameState(GAME_STATE.INCOMING);
    flightDuration = duration;
    ballStartTime = Date.now();
    
    audio.play('ping');

    // Start tracking loop for haptics/visuals
    cancelAnimationFrame(animationFrameId);
    updateIncomingLoop();

    // Set timeout for missing the ball
    // If timer fires, player failed to hit
    incomingBallTimer = setTimeout(() => {
        if (state === GAME_STATE.INCOMING) {
            // Missed!
            audio.play('miss');
            myScore++; // Opponent gets point actually... wait. 
            // Logic: I missed, so opponent gets point.
            // BUT: My local score var tracks MY score. So opponent gets point.
            // Wait, logic inversion.
            // If *I* miss, *Opponent* gets point.
            // I need to tell Opponent they scored.
            sendData('POINT_SCORED', {});
            oppScore++; // Update local display of opp score
            updateScoreUI();
            
            // If I miss, opponent serves.
            setGameState(GAME_STATE.IDLE);
        }
    }, duration + 200); // 200ms grace period
}

function updateIncomingLoop() {
    if (state !== GAME_STATE.INCOMING) {
        audio.setDroneIntensity(0);
        return;
    }

    const now = Date.now();
    const elapsed = now - ballStartTime;
    const progress = Math.min(elapsed / flightDuration, 1.0);
    
    // Proximity = progress^2 (non-linear ramp up)
    const proximity = progress * progress;

    // Visuals: Ball grows
    // Ball starts small and centered, grows "towards" user
    const scale = 0.1 + (progress * 2.0); // 0.1 -> 2.1
    ui.ball.style.opacity = Math.min(progress + 0.2, 1);
    ui.ball.style.transform = `scale(${scale})`;

    // Audio Drone
    audio.setDroneIntensity(proximity);

    // Haptics: Pulse
    // Browser vibration is limited. We can try to pulse based on proximity.
    // If very close, vibrate constant
    if (progress > 0.8) {
        if (Math.random() > 0.5) { // Random noise vibration
             if (navigator.vibrate) navigator.vibrate(10); // tiny pulses
        }
    }

    if (progress < 1.0) {
        animationFrameId = requestAnimationFrame(updateIncomingLoop);
    }
}

function updateScoreUI() {
    ui.scoreMe.textContent = myScore;
    ui.scoreOpp.textContent = oppScore;
}