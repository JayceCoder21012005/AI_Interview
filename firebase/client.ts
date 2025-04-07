import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";


const firebaseConfig = {
  apiKey: "AIzaSyDbxXC3tirg81kGYEhRh2Sjcv3DYC7gk0g",
  authDomain: "jayceai-19ff4.firebaseapp.com",
  projectId: "jayceai-19ff4",
  storageBucket: "jayceai-19ff4.firebasestorage.app",
  messagingSenderId: "971590979351",
  appId: "1:971590979351:web:80bad6ee60da470b0c3152",
  measurementId: "G-G3CQK7FHSS"
};

// Initialize Firebase
const app = !getApps.length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);