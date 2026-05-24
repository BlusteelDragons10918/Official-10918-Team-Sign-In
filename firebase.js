import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"; 
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"; 
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js"; 

const firebaseConfig = { 
  apiKey: "__FIREBASE_API_KEY__", 
  authDomain: "__FIREBASE_AUTH_DOMAIN__", 
  projectId: "__FIREBASE_PROJECT_ID__", 
  storageBucket: "__FIREBASE_STORAGE_BUCKET__", 
  messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__", 
  appId: "__FIREBASE_APP_ID__", 
  measurementId: "__FIREBASE_MEASUREMENT_ID__" 
}; 

const app = initializeApp(firebaseConfig); 

export const db = getFirestore(app); 
export const auth = getAuth(app);

