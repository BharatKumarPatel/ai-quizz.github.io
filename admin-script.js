import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// 1. CONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyBdK4ZRrRcmisVVOW_hTMIowtts2I4iGzA",
  authDomain: "ai-quizz-97fb9.firebaseapp.com",
  databaseURL: "https://ai-quizz-97fb9-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ai-quizz-97fb9",
  storageBucket: "ai-quizz-97fb9.firebasestorage.app",
  messagingSenderId: "572423560278",
  appId: "1:572423560278:web:c15c0e8a14b452068f2ff7"
};

// --- GEMINI KEY ---
const GEMINI_API_KEY = "AIzaSyDp3CGpIEEWvijoan3o-VL2y9BMtzhzNS0"; 
// ------------------

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // 2.0 or 2.5 Flash

// 2. QUIZ TARGETS
const TARGETS = [
    { class: "6", stream: "General" },
    { class: "7", stream: "General" },
    { class: "8", stream: "General" },
    { class: "9", stream: "General" },
    { class: "10", stream: "General" },
    { class: "11", stream: "Science" },
    { class: "11", stream: "Commerce" },
    { class: "11", stream: "Arts" },
    { class: "12", stream: "Science" },
    { class: "12", stream: "Commerce" },
    { class: "12", stream: "Arts" }
];

const logBox = document.getElementById('logs');
const btn = document.getElementById('start-btn');

function log(msg) {
    const time = new Date().toLocaleTimeString();
    logBox.innerHTML += `<div>[${time}] ${msg}</div>`;
    logBox.scrollTop = logBox.scrollHeight;
}

// 3. DELAY FUNCTION (Changed to 60 seconds for testing, but ideally 3 mins)
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 4. GENERATION LOGIC
btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerText = "Processing (Do not close tab)...";
    
    const today = new Date().toISOString().split('T')[0];
    log(`🚀 Starting Generation for Date: ${today}`);

    for (let i = 0; i < TARGETS.length; i++) {
        const target = TARGETS[i];
        const targetName = `Class ${target.class} (${target.stream})`;
        
        try {
            log(`⚡ Generating: ${targetName}`);
            
            // Step A: Call Gemini
            const questions = await fetchQuestionsFromAI(target.class, target.stream);
            
            // Step B: Save to Firebase
            const dbPath = `daily_quizzes/${today}/class_${target.class}_${target.stream}`;
            await set(ref(db, dbPath), questions);
            
            log(`✅ Saved to Database: ${targetName}`);

        } catch (error) {
            log(`❌ ERROR on ${targetName}: ${error.message}`);
            log(`⚠️ Waiting before retry to clear limits...`);
        } finally {
            // Step C: ALWAYS WAIT (Chahe Error ho ya Success)
            if (i < TARGETS.length - 1) {
                // Maine wait time 2 minute (120000ms) kar diya hai safety ke liye
                log(`⏳ Cooldown: Waiting 2 minutes...`);
                await wait(120000); 
            }
        }
    }

    log(`🎉 ALL DONE! Batch Process Completed.`);
    btn.innerText = "Completed";
});

async function fetchQuestionsFromAI(cls, stream) {
    const prompt = `
    Generate 10 challenging multiple-choice questions for a Class ${cls} student studying ${stream}.
    Include the correct answer and a short explanation for why the answer is correct.
    
    Strictly return this JSON format array:
    [
      {
        "id": 1,
        "q": "Question text?",
        "opt": ["A", "B", "C", "D"],
        "correct": "A",
        "exp": "Because A is the powerhouse of the cell..."
      }
    ]
    Do not add markdown formatting. Just raw JSON.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);
    } catch (e) {
        throw new Error("AI Parsing Failed: " + e.message);
    }
}