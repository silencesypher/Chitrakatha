/* The only module that touches the global `firebase` SDK. Everything else talks
   to the database through net/store.js, which keeps the rest of the codebase
   importable in a plain Node process for tests. */
import { firebaseConfig, CONFIG_READY } from "./config.js";

export let db = null;                 // live binding: importers see this once assigned
export let firebaseInitError = null;

if(CONFIG_READY){
  try{
    if(typeof firebase === "undefined"){
      throw new Error("Firebase SDK script did not load (check your internet connection or an ad-blocker).");
    }
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
  }catch(e){
    firebaseInitError = e;
    console.error("Firebase init failed:", e);
  }
}
