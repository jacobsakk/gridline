// Firebase project config. These values identify the project (not secret
// credentials) -- access control comes entirely from the Firestore security
// rules deployed alongside this app (see firestore.rules), which scope
// read/write to just the "watchlist" collection.
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAokApn-a75wF0zY3eXncmvgikdAFG0qlE",
  authDomain: "gridline-6afe6.firebaseapp.com",
  projectId: "gridline-6afe6",
  storageBucket: "gridline-6afe6.firebasestorage.app",
  messagingSenderId: "634127081395",
  appId: "1:634127081395:web:703f5b4de6cf9238b835c6",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
