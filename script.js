import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    sendPasswordResetEmail, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getDatabase, 
    ref, 
    get, 
    set, 
    child 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// =========================================
// 1. CONFIGURATION & SETUP
// =========================================
const firebaseConfig = {
  apiKey: "AIzaSyBdK4ZRrRcmisVVOW_hTMIowtts2I4iGzA",
  authDomain: "ai-quizz-97fb9.firebaseapp.com",
  databaseURL: "https://ai-quizz-97fb9-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ai-quizz-97fb9",
  storageBucket: "ai-quizz-97fb9.firebasestorage.app",
  messagingSenderId: "572423560278",
  appId: "1:572423560278:web:c15c0e8a14b452068f2ff7"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// --- AUDIO ENGINE ---
const audio = {
    click: document.getElementById('sfx-click'),
    success: document.getElementById('sfx-success'),
    error: document.getElementById('sfx-error')
};

function playSound(type) {
    if(audio[type]) {
        audio[type].currentTime = 0;
        audio[type].play().catch(() => {}); // Ignore if file missing
    }
}

// --- STATE VARIABLES ---
let currentUser = null;
let userProfile = null;
let todaysQuizData = [];
let quizTimerInterval = null;

// =========================================
// 2. AUTHENTICATION LOGIC
// =========================================

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        // User Logged In
        updateNavUser(user.email);
        await checkUserProfile(user.uid);
    } else {
        // User Logged Out
        showView('auth');
    }
});

async function checkUserProfile(uid) {
    try {
        const snapshot = await get(child(ref(db), `users/${uid}/profile`));
        if (snapshot.exists()) {
            userProfile = snapshot.val();
            loadDashboard(); // Success -> Go to Dashboard
        } else {
            // New User -> Show Setup Modal
            openSettingsModal(true); // true = Force Mode (No Close Button)
        }
    } catch (error) {
        console.error("Profile Error:", error);
        alert("Connection Failed. Refresh Page.");
    }
}

// Login Handler
document.getElementById('form-login').onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-pass').value;
    const btn = e.target.querySelector('button');
    
    setLoading(btn, true, "VERIFYING...");
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        showError(parseAuthError(error));
        setLoading(btn, false, "ENTER ARENA");
    }
};

// Signup Handler
document.getElementById('form-signup').onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('signup-email').value;
    const pass = document.getElementById('signup-pass').value;
    const btn = e.target.querySelector('button');

    setLoading(btn, true, "CREATING ID...");
    try {
        await createUserWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        showError(parseAuthError(error));
        setLoading(btn, false, "CREATE ACCOUNT");
    }
};

document.getElementById('logout-btn').onclick = () => {
    signOut(auth);
    localStorage.clear(); // Clear local data on logout
    location.reload();
};

// =========================================
// 3. SETTINGS & PROFILE MANAGEMENT
// =========================================

// Open Settings (Gear Icon)
document.getElementById('settings-btn').onclick = () => {
    openSettingsModal(false); // false = Edit Mode (Allow Close)
    // Pre-fill current values
    if(userProfile) {
        document.getElementById('setup-class').value = userProfile.class;
        document.getElementById('setup-stream').value = userProfile.stream;
        document.getElementById('setup-stream-group').classList.remove('d-none');
    }
};

// Close Settings (X Button)
document.getElementById('btn-close-modal').onclick = () => {
    document.getElementById('onboarding-modal').classList.add('d-none');
};

function openSettingsModal(isForced) {
    const modal = document.getElementById('onboarding-modal');
    const closeBtn = document.getElementById('btn-close-modal');
    
    document.getElementById('auth-view').classList.add('d-none'); // Hide login if visible
    modal.classList.remove('d-none');
    
    if(isForced) {
        closeBtn.classList.add('d-none'); // Cannot close if new user
    } else {
        closeBtn.classList.remove('d-none'); // Can close if editing
    }
}

// Save Profile
document.getElementById('btn-save-profile').onclick = async function() {
    const cls = document.getElementById('setup-class').value;
    let stream = document.getElementById('setup-stream').value;
    
    if (!cls) return alert("Select Class!");
    if (parseInt(cls) < 11) stream = "General";

    const btn = this;
    setLoading(btn, true, "SAVING...");
    playSound('click');

    try {
        await set(ref(db, `users/${currentUser.uid}/profile`), { class: cls, stream: stream });
        location.reload(); // Reload to refresh dashboard with new class data
    } catch (error) {
        alert("Save Failed: " + error.message);
        setLoading(btn, false, "SAVE PROFILE");
    }
};

// =========================================
// 4. DASHBOARD & QUIZ LOADING
// =========================================

async function loadDashboard() {
    showView('dashboard');
    
    // Update Header
    const username = currentUser.email.split('@')[0].toUpperCase();
    document.getElementById('dash-username').innerText = username;
    document.getElementById('dash-class-badge').innerText = `CLASS ${userProfile.class} • ${userProfile.stream}`;

    const quizBtn = document.getElementById('btn-start-quiz');
    quizBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> SEARCHING MISSION...';
    quizBtn.disabled = true;

    // --- DATE LOGIC (Must match Admin Script) ---
    // Admin uses: new Date().toISOString().split('T')[0] (UTC Date)
    const today = new Date().toISOString().split('T')[0];
    const quizPath = `daily_quizzes/${today}/class_${userProfile.class}_${userProfile.stream}`;

    // Check if user already completed today's quiz (Anti-Replay)
    const historyKey = `aiquiz_done_${today}_${currentUser.uid}`;
    if(localStorage.getItem(historyKey) === "true") {
         quizBtn.innerHTML = "MISSION COMPLETED<br><small>Come back tomorrow</small>";
         quizBtn.classList.add('btn-beast-white');
         return;
    }

    try {
        const snapshot = await get(child(ref(db), quizPath));
        if (snapshot.exists()) {
            todaysQuizData = snapshot.val();
            
            quizBtn.innerHTML = `START DAILY QUIZ <br><span style="font-size:0.8rem">(${todaysQuizData.length} Questions Ready)</span>`;
            quizBtn.classList.remove('btn-beast-white');
            quizBtn.classList.add('btn-beast-primary');
            quizBtn.disabled = false;
            quizBtn.onclick = () => startQuizGame(today);
        } else {
            quizBtn.innerText = "NO MISSION TODAY";
            quizBtn.classList.add('btn-beast-white');
            quizBtn.classList.remove('btn-beast-primary');
        }
    } catch (error) {
        console.error(error);
        quizBtn.innerText = "SYSTEM ERROR";
    }
}

// =========================================
// 5. QUIZ GAME ENGINE (With Anti-Cheat)
// =========================================

function startQuizGame(dateKey) {
    showView('quiz');
    playSound('click');
    
    // --- ANTI-CHEAT: RESTORE STATE ---
    const savedTime = localStorage.getItem(`aiquiz_timer_${dateKey}`);
    const savedAnswers = JSON.parse(localStorage.getItem(`aiquiz_answers_${dateKey}`) || '{}');
    
    let timeRemaining = savedTime ? parseInt(savedTime) : 600; // 10 mins or saved time
    
    // Render Questions
    renderQuestions(savedAnswers);

    // Start Timer
    clearInterval(quizTimerInterval);
    updateTimerDisplay(timeRemaining);
    
    quizTimerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay(timeRemaining);
        
        // Save to LocalStorage (Anti-Refresh Cheat)
        localStorage.setItem(`aiquiz_timer_${dateKey}`, timeRemaining);

        if(timeRemaining <= 0) {
            submitQuiz(dateKey);
        }
    }, 1000);

    // Attach Submit Handler
    document.getElementById('btn-submit-quiz').onclick = () => submitQuiz(dateKey);
}

function renderQuestions(savedAnswers) {
    const container = document.getElementById('quiz-content-area');
    container.innerHTML = ''; // Clear skeleton

    todaysQuizData.forEach((q, index) => {
        const qDiv = document.createElement('div');
        qDiv.className = "beast-card mb-4";
        qDiv.style.marginBottom = "30px";
        
        // Check if previously answered
        const preSelected = savedAnswers[index];

        qDiv.innerHTML = `
            <h3 style="margin-bottom:15px;">Q${index+1}. ${q.q}</h3>
            <div class="options-grid" id="q-grid-${index}">
                ${q.opt.map(opt => {
                    // Visual check for saved answer
                    const isSelected = preSelected === opt ? 
                        'background:var(--beast-yellow); color:black;' : 'background:white; color:black;';
                    
                    return `<button class="btn-beast-white option-btn" 
                        style="${isSelected}"
                        onclick="handleOptionClick(${index}, '${opt}', this)">
                        ${opt}
                    </button>`;
                }).join('')}
            </div>
        `;
        container.appendChild(qDiv);
    });

    document.getElementById('btn-submit-quiz').classList.remove('d-none');
}

// Global scope for HTML onclick
window.handleOptionClick = (qIndex, opt, btn) => {
    playSound('click');
    
    // 1. Visually select
    const grid = document.getElementById(`q-grid-${qIndex}`);
    const allBtns = grid.querySelectorAll('.option-btn');
    allBtns.forEach(b => {
        b.style.background = 'white';
        b.style.color = 'black';
    });
    btn.style.background = 'var(--beast-yellow)';
    
    // 2. Save to Storage (Persistence)
    const today = new Date().toISOString().split('T')[0];
    const currentAnswers = JSON.parse(localStorage.getItem(`aiquiz_answers_${today}`) || '{}');
    currentAnswers[qIndex] = opt;
    localStorage.setItem(`aiquiz_answers_${today}`, JSON.stringify(currentAnswers));
};

function updateTimerDisplay(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    document.getElementById('quiz-timer').innerText = `${m}:${s < 10 ? '0'+s : s}`;
    
    // Warning Color
    if(seconds < 60) document.getElementById('quiz-timer').style.color = 'var(--beast-pink)';
}

// =========================================
// 6. SCORING & RESULTS (The Bug Fix)
// =========================================

async function submitQuiz(dateKey) {
    clearInterval(quizTimerInterval);
    const btn = document.getElementById('btn-submit-quiz');
    setLoading(btn, true, "CALCULATING RESULTS...");

    // Retrieve final answers from storage
    const userAnswers = JSON.parse(localStorage.getItem(`aiquiz_answers_${dateKey}`) || '{}');
    
    let score = 0;
    let maxScore = todaysQuizData.length * 5;

    todaysQuizData.forEach((q, index) => {
        const userAnsFull = userAnswers[index] || "";
        
        // --- FIX: EXTRACT LETTER FROM ANSWER ---
        // Admin saves "A". User clicks "A) Mars".
        // We split by ")" and take the first part.
        const userLetter = userAnsFull.split(')')[0].trim(); // Gets "A" from "A) Mars"
        
        if(userLetter === q.correct) {
            score += 5;
        }
    });

    // Save to Firebase
    const scorePath = `leaderboard/${dateKey}/class_${userProfile.class}_${userProfile.stream}/${currentUser.uid}`;
    try {
        await set(ref(db, scorePath), {
            email: currentUser.email,
            score: score,
            timestamp: Date.now()
        });
        
        // Mark as Done in LocalStorage (Prevent Replay)
        localStorage.setItem(`aiquiz_done_${dateKey}_${currentUser.uid}`, "true");
        // Clear temp game state
        localStorage.removeItem(`aiquiz_timer_${dateKey}`);
        localStorage.removeItem(`aiquiz_answers_${dateKey}`);

        playSound('success');
        showResultScreen(score, maxScore, userAnswers);

    } catch (error) {
        console.error(error);
        alert("Result Upload Failed. Check Internet.");
        setLoading(btn, false, "RETRY SUBMIT");
    }
}

function showResultScreen(score, maxScore, userAnswers) {
    const container = document.getElementById('quiz-content-area');
    
    let html = `
        <div class="text-center mb-5">
            <h1 class="beast-title">MISSION COMPLETE</h1>
            <div style="font-size:4rem; font-family:'Archivo Black'; color:var(--beast-pink);">${score} / ${maxScore}</div>
            <p class="subtitle">FINAL SCORE</p>
            <button onclick="location.reload()" class="btn-beast-primary">RETURN TO DASHBOARD</button>
        </div>
        <hr style="border:2px solid black; margin:30px 0;">
        <h2>PERFORMANCE ANALYSIS</h2>
    `;

    todaysQuizData.forEach((q, index) => {
        const userAnsFull = userAnswers[index] || "Not Answered";
        const userLetter = userAnsFull.split(')')[0].trim();
        const isCorrect = userLetter === q.correct;
        
        html += `
            <div class="beast-card mb-3" style="border-left: 10px solid ${isCorrect ? '#00E676' : '#FF0080'};">
                <h4>Q${index+1}: ${q.q}</h4>
                <div style="display:flex; justify-content:space-between; margin-top:10px; font-weight:bold;">
                    <span style="color:${isCorrect ? 'green' : 'red'}">YOU: ${userAnsFull}</span>
                    <span style="color:green;">CORRECT: ${q.correct}</span>
                </div>
                <div style="background:#f4f4f5; padding:10px; margin-top:10px; font-size:0.9rem;">
                    <strong>INTEL:</strong> ${q.exp}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    document.getElementById('btn-submit-quiz').classList.add('d-none');
    document.querySelector('.quiz-header').classList.add('d-none'); // Hide timer
    window.scrollTo(0,0);
}

// =========================================
// 7. UI HELPERS
// =========================================

function showView(name) {
    Object.values({
        auth: document.getElementById('auth-view'),
        dashboard: document.getElementById('dashboard-view'),
        quiz: document.getElementById('quiz-view')
    }).forEach(el => el.classList.add('d-none'));
    
    document.getElementById('navbar').classList.add('d-none');

    if (name === 'dashboard') {
        document.getElementById('dashboard-view').classList.remove('d-none');
        document.getElementById('navbar').classList.remove('d-none');
    } else if (name === 'auth') {
        document.getElementById('auth-view').classList.remove('d-none');
    } else if (name === 'quiz') {
        document.getElementById('quiz-view').classList.remove('d-none');
    }
}

function updateNavUser(email) {
    document.getElementById('nav-user-email').innerText = email.split('@')[0];
}

function setLoading(btn, isLoading, text) {
    btn.disabled = isLoading;
    btn.innerHTML = isLoading ? `<span class="spinner-border spinner-border-sm"></span> ${text}` : text;
}

function showError(msg) {
    const box = document.getElementById('auth-msg-box');
    box.innerText = msg;
    box.classList.remove('d-none');
    setTimeout(() => box.classList.add('d-none'), 4000);
}

function parseAuthError(error) {
    if (error.code === 'auth/invalid-credential') return "WRONG EMAIL OR PASSWORD.";
    if (error.code === 'auth/email-already-in-use') return "EMAIL ALREADY REGISTERED.";
    return error.message;
}

// Auth Form Toggles
document.getElementById('btn-show-signup').onclick = () => toggleAuth('signup');
document.getElementById('btn-show-forgot').onclick = () => toggleAuth('forgot');
document.getElementById('btn-back-login-1').onclick = () => toggleAuth('login');
document.getElementById('btn-back-login-2').onclick = () => toggleAuth('login');

function toggleAuth(section) {
    ['login', 'signup', 'forgot'].forEach(s => document.getElementById(`section-${s}`).classList.add('d-none'));
    document.getElementById(`section-${section}`).classList.remove('d-none');
}

// Setup Stream Toggle
document.getElementById('setup-class').onchange = (e) => {
    const val = parseInt(e.target.value);
    const box = document.getElementById('setup-stream-group');
    val >= 11 ? box.classList.remove('d-none') : box.classList.add('d-none');
};