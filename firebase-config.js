// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
// Authentication support
import { getAuth } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBTMppxpaAEQYJ1vElCvSzpuvm30AbSCD4",
    authDomain: "nfl-pickem-d3f4d.firebaseapp.com",
    projectId: "nfl-pickem-d3f4d",
    storageBucket: "nfl-pickem-d3f4d.firebasestorage.app",
    messagingSenderId: "679774828108",
    appId: "1:679774828108:web:c8eb9f1b9aad6e4a4626e9"
};

// Initialize Firebase and Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app); // Initialize Auth

export { db, auth };
