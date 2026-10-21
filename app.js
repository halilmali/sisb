/* ========================================
   SISB Behaviour Point — Merit System
   Firebase v9+ Modular SDK
   ======================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

/* ========================================
   CONFIGURATION
   ======================================== */
const firebaseConfig = {
  apiKey: "AIzaSyBx9ZmKu6veqnvy4dffw2eQ3dbLJ2r8SMU",
  authDomain: "sisb-honor.firebaseapp.com",
  projectId: "sisb-honor",
  storageBucket: "sisb-honor.firebasestorage.app",
  messagingSenderId: "816651541913",
  appId: "1:816651541913:web:0873baf5802d03cb81c708",
  measurementId: "G-2S1XK4PBL7"
};

/* ========================================
   INITIALIZE FIREBASE
   ======================================== */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/* ========================================
   LAZY FIRESTORE SDK
   ----------------------------------------
   The Firestore SDK (~150KB transferred, mostly unused on the logged-out
   landing) is imported on demand after sign-in. The symbols below keep their
   usual names so call sites are unchanged — they are assigned when the
   module arrives via loadFirestore().
   ======================================== */
let db;
let getFirestore, initializeFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, increment, runTransaction, query, where, onSnapshot, orderBy,
  limit, serverTimestamp, writeBatch, Timestamp,
  persistentLocalCache, persistentMultipleTabManager;

let firestoreReady = null;
function loadFirestore() {
  if (firestoreReady) return firestoreReady;
  firestoreReady = import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js")
    .then((fs) => {
      ({ getFirestore, initializeFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
         updateDoc, deleteDoc, increment, runTransaction, query, where, onSnapshot, orderBy,
         limit, serverTimestamp, writeBatch, Timestamp,
         persistentLocalCache, persistentMultipleTabManager } = fs);
      try {
        // Persistent IndexedDB cache: reads satisfied from the local cache are
        // free, so page reloads / reconnects stop re-billing the full dataset.
        db = fs.initializeFirestore(app, {
          localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
        });
      } catch (persistError) {
        console.warn("Persistent cache unavailable, falling back to default:", persistError);
        db = fs.getFirestore(app);
      }
      return fs;
    })
    .catch((err) => {
      firestoreReady = null; // allow a retry on the next sign-in
      throw err;
    });
  return firestoreReady;
}
const provider = new GoogleAuthProvider();

/* ========================================
   HOUSES
   ======================================== */
const HOUSES = ["Green", "Blue", "Yellow", "Red", "Orange"];

/* ========================================
   UNIFORM AWARD WINDOW (school-wide schedule)
   ----------------------------------------
   Uniform points can only be awarded during this window. Defined in
   Bangkok local time (UTC+7, no DST). Keep in sync with firestore.rules
   (isUniformAwardWindow) — this is the single source of truth.
   ======================================== */
const BANGKOK_UTC_OFFSET_MIN = 7 * 60;            // Bangkok is UTC+7
// getDay(): 1=Mon, 2=Tue, 3=Wed, 5=Fri — Thursday (4) is NOT an award day.
const UNIFORM_WINDOW_WEEKDAYS = [1, 2, 3, 5];
const UNIFORM_WINDOW_START_MIN = 7 * 60;          // 07:00 Bangkok
const UNIFORM_WINDOW_END_MIN = 7 * 60 + 30;       // 07:30 Bangkok (exclusive)

/* ========================================
   ADMIN — stored in Firestore config/admin document
   ======================================== */
let adminEmails = [];

const ADMIN_CACHE_KEY = "sisb_admin_config_cache";
const ADMIN_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function fetchAdminConfig(force = false) {
  try {
    // Serve the admin list from sessionStorage when fresh — this config
    // rarely changes and skipping the read on every login saves a read.
    if (!force) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(ADMIN_CACHE_KEY) || "null");
        if (cached && Date.now() - cached.fetchedAt < ADMIN_CACHE_TTL) {
          adminEmails = cached.emails || [];
          return;
        }
      } catch (e) { /* ignore unreadable/malformed cache */ }
    }

    const adminRef = doc(db, "config", "admin");
    const adminSnap = await getDoc(adminRef);
    if (adminSnap.exists()) {
      adminEmails = adminSnap.data().emails || [];
    }
    try {
      sessionStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify({ emails: adminEmails, fetchedAt: Date.now() }));
    } catch (e) { /* ignore storage quota errors */ }
  } catch (error) {
    console.error("Error fetching admin config:", error);
  }
}

function isAdmin() {
  return currentUser && adminEmails.includes(currentUser.email);
}

// LH (house leader) users and admins may award the +10 bonus.
function canGive10Points() {
  return isAdmin() || currentUserRole === "LH";
}

function roleLabel(role) {
  if (role === "LH") return "House Leader";
  return "Teacher";
}

/* ========================================
   MERIT LOG PAYLOAD
   ----------------------------------------
   The log stores who was credited (always the signed-in user) plus, for
   admin awards, who actually clicked.
   ======================================== */
// Shared meritLog payload — deliberately detailed so the admin log view can
// answer who / what / for whom / when without extra reads.
function buildLogEntry({ studentId, studentName, house, type, change }) {
  const student = allStudents.find((s) => s.id === studentId);
  const entry = {
    studentId,
    studentName,
    house,
    studentClass: student?.className || "",
    type,
    change,
    teacherEmail: currentUser?.email || "", // credited teacher (the signed-in user)
    timestamp: serverTimestamp()
  };
  if (isAdmin()) {
    entry.awardedBy = currentUser?.email || "";
    entry.awardedByRole = "admin";
  }
  return entry;
}

const HOUSE_EMOJIS = {
  Green:  "🟢",
  Blue:   "🔵",
  Yellow: "🟡",
  Red:    "🔴",
  Orange: "🟠"
};

/* ========================================
   DOM REFS — General
   ======================================== */
const $ = (sel) => document.querySelector(sel);

const loginScreen       = $("#loginScreen");
const dashboardScreen   = $("#dashboardScreen");
const googleSignInBtn   = $("#googleSignInBtn");
const logoutBtn         = $("#logoutBtn");
const logoutFromDeniedBtn = $("#logoutFromDeniedBtn");
const userAvatar        = $("#userAvatar");
const userEmail         = $("#userEmail");
const toastContainer    = $("#toastContainer");

/* Dashboard view */
const dashboardView     = $("#dashboardView");
const studentGrid       = $("#studentGrid");
const loadingState      = $("#loadingState");
const emptyState        = $("#emptyState");
const errorState        = $("#errorState");
const errorMessage      = $("#errorMessage");
const accessDenied      = $("#accessDenied");
const retryBtn          = $("#retryBtn");

/* Sidebar & Filter */
const houseFilterSelect = $("#houseFilterSelect");
const filterIndicator  = $("#filterIndicator");
const filterLabel      = $("#filterLabel");
const clearFilterBtn   = $("#clearFilterBtn");

/* Management view */
const manageView        = $("#manageView");
const manageToggleBtn   = $("#manageToggleBtn");
const backToDashboardBtn = $("#backToDashboardBtn");

/* Teachers view */
const teachersView         = $("#teachersView");
const teachersToggleBtn    = $("#teachersToggleBtn");
const backFromTeachersBtn  = $("#backFromTeachersBtn");
const teacherEmailInput    = $("#teacherEmailInput");
const teacherRoleSelect    = $("#teacherRoleSelect");
const addTeacherBtn        = $("#addTeacherBtn");
const teacherBulkInput     = $("#teacherBulkInput");
const teacherBulkRoleSelect = $("#teacherBulkRoleSelect");
const addTeachersBulkBtn   = $("#addTeachersBulkBtn");
const teacherTableBody     = $("#teacherTableBody");
const teacherCount         = $("#teacherCount");

/* Scoreboard view */
const scoreboardView         = $("#scoreboardView");
const scoreboardToggleBtn    = $("#scoreboardToggleBtn");
const backFromScoreboardBtn  = $("#backFromScoreboardBtn");
const scoreboardContent      = $("#scoreboardContent");

/* Log view */
const logView              = $("#logView");
const logToggleBtn         = $("#logToggleBtn");
const backFromLogBtn       = $("#backFromLogBtn");
const logTableBody         = $("#logTableBody");
const logCount             = $("#logCount");
const studentNameInput    = $("#studentNameInput");
const studentHouseSelect  = $("#studentHouseSelect");
const studentClassInput   = $("#studentClassInput");
const studentEmailInput   = $("#studentEmailInput");
const addStudentSingleBtn = $("#addStudentSingleBtn");
const classFilterSelect = $("#classFilterSelect");
const sortFilterSelect  = $("#sortFilterSelect");
const uploadArea        = $("#uploadArea");
const fileInput         = $("#fileInput");
const uploadPreview     = $("#uploadPreview");
const previewBody       = $("#previewBody");
const previewCount      = $("#previewCount");
const importBtn         = $("#importBtn");
const cancelPreviewBtn  = $("#cancelPreviewBtn");
const manageStudentBody = $("#manageStudentBody");
const manageStudentCount = $("#manageStudentCount");

/* Student view */
const studentView           = $("#studentView");
const studentProfileEmpty   = $("#studentProfileEmpty");
const studentProfileHonor   = $("#studentProfileHonor");
const studentProfileUniform = $("#studentProfileUniform");
const downloadTemplateBtn   = $("#downloadTemplateBtn");

/* Log filters (admin) */
const logStudentFilter = $("#logStudentFilter");
const logTeacherFilter = $("#logTeacherFilter");
const logTypeFilter    = $("#logTypeFilter");
const logDateFilter    = $("#logDateFilter");
const logDateInput     = $("#logDateInput");
const logLoadMoreWrap  = $("#logLoadMoreWrap");
const logLoadMoreBtn   = $("#logLoadMoreBtn");
const logShowingStatus = $("#logShowingStatus");

/* Student history modal */
const studentHistoryModal     = $("#studentHistoryModal");
const historyStudentAvatar    = $("#historyStudentAvatar");
const historyStudentName      = $("#historyStudentName");
const historyStudentMeta      = $("#historyStudentMeta");
const historySummary          = $("#historySummary");
const historyTeacherBreakdown = $("#historyTeacherBreakdown");
const historyTableBody        = $("#historyTableBody");
const historyCloseBtn         = $("#historyCloseBtn");

/* Top rankings (log view buttons + modals) */
const topStudentsBtn       = $("#topStudentsBtn");
const topTeachersBtn       = $("#topTeachersBtn");
const topStudentsModal     = $("#topStudentsModal");
const topStudentsCloseBtn  = $("#topStudentsCloseBtn");
const topStudentsSubtitle  = $("#topStudentsSubtitle");
const topStudentsWeekNav   = $("#topStudentsWeekNav");
const topStudentsWeekLabel = $("#topStudentsWeekLabel");
const topStudentsWeekScopeBtn = $("#topStudentsWeekScopeBtn");
const topStudentsAllScopeBtn  = $("#topStudentsAllScopeBtn");
const topStudentsPrevBtn   = $("#topStudentsPrevBtn");
const topStudentsNextBtn   = $("#topStudentsNextBtn");
const topBehaviorList      = $("#topBehaviorList");
const topUniformList       = $("#topUniformList");
const topTeachersModal     = $("#topTeachersModal");
const topTeachersCloseBtn  = $("#topTeachersCloseBtn");
const topTeachersSubtitle  = $("#topTeachersSubtitle");
const topTeachersWeekNav   = $("#topTeachersWeekNav");
const topTeachersWeekLabel = $("#topTeachersWeekLabel");
const topTeachersBehaviorList = $("#topTeachersBehaviorList");
const topTeachersUniformList  = $("#topTeachersUniformList");
const topTeachersPrevBtn   = $("#topTeachersPrevBtn");
const topTeachersNextBtn   = $("#topTeachersNextBtn");
const topTeachersWeekScopeBtn = $("#topTeachersWeekScopeBtn");
const topTeachersAllScopeBtn  = $("#topTeachersAllScopeBtn");

/* Archive view (admin only) */
const archiveToggleBtn          = $("#archiveToggleBtn");
const archiveView               = $("#archiveView");
const backFromArchiveBtn        = $("#backFromArchiveBtn");
const archiveNowBtn             = $("#archiveNowBtn");
const archiveCount              = $("#archiveCount");
const archiveTableBody          = $("#archiveTableBody");
const archiveDetailModal        = $("#archiveDetailModal");
const archiveDetailTitle        = $("#archiveDetailTitle");
const archiveDetailMeta         = $("#archiveDetailMeta");
const archiveDetailSummary      = $("#archiveDetailSummary");
const archiveDetailStudentsBody = $("#archiveDetailStudentsBody");
const archiveDetailStudentsNote = $("#archiveDetailStudentsNote");
const archiveDetailTeachersBody = $("#archiveDetailTeachersBody");
const archiveDetailTeachersNote = $("#archiveDetailTeachersNote");
const archiveDetailCloseBtn     = $("#archiveDetailCloseBtn");
const archiveDetailDownloadBtn  = $("#archiveDetailDownloadBtn");

/* ========================================
   STATE
   ======================================== */
let currentUser = null;
let currentStudent = null;
let currentUserRole = null; // role stored on the logged-in user's allowedUsers doc
let currentUserHomeroom = null; // homeroom class stored on the allowedUsers doc
let unsubscribeStudents = null;
let unsubscribeStudent = null;
let unsubscribeTeachers = null;
let unsubscribeLog = null;
let allStudents = [];
let parsedImportData = [];
let selectedHouse = null;
let selectedClass = null;
let scoreboardType = "honor";
let pointType = "honor"; // grid-wide: "honor" | "uniform"
let sortBy = "name"; // "name" | "honor" | "uniform"
let allLogEntries = [];
let logTeacherFilterValue = "";
let logTypeFilterValue = "";
let logDateFilterValue = "all";
let logDateCustomValue = "";
let logLimit = 200;
let logHasMore = false;
let logStudentFilterValue = "";
let unsubscribeHistory = null;
let teacherWeekOffset = 0; // 0 = last school week (Mon–Fri), 1 = current week, -1 = week before…
let topStudentScope = "week"; // "week" | "all"
let studentWeekOffset = 0;
let topTeacherScope = "week"; // "week" | "all"
let allArchives = [];
let unsubscribeArchives = null;
let openArchiveId = null; // archive currently shown in the detail modal

/* Student history modal refs (DOM elements defined above). */

/* ========================================
   TOAST SYSTEM
   ======================================== */
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

/* ========================================
   AUTH STATE MANAGEMENT
   ======================================== */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    // The role checks below read Firestore, so make sure the SDK is in.
    try {
      await loadFirestore();
    } catch (err) {
      console.error("Failed to load the Firestore SDK:", err);
      showToast("Couldn't load data services. Check your connection and reload.", "error");
      return;
    }
    // Check the student role first (the majority of users) so they pay one
    // read; teachers pay one read for the empty student lookup plus one for
    // the allowedUsers doc. Previously every login paid 2–3 reads.
    const student = await findStudentByEmail(user.email);
    if (student) {
      currentStudent = student;
      showStudentView();
      setupStudentListener();
    } else {
      const isTeacher = await checkIfAllowed(user.email);
      if (isTeacher) {
        await fetchAdminConfig();
        showDashboardView();
        // The admin list just loaded — refresh the Uniform tab immediately so
        // admins can use it right away instead of waiting for the 30s tick.
        applyUniformTabAvailability();
        // Homeroom teachers get Uniform + their class preselected in-window.
        applyHomeroomDefaults();
        setupRealTimeListener();
      } else {
        await fetchAdminConfig();
        showAccessDenied();
      }
    }
  } else {
    currentUser = null;
    currentStudent = null;
    currentUserRole = null;
    currentUserHomeroom = null;
    showLogin();
    if (unsubscribeStudents) {
      unsubscribeStudents();
      unsubscribeStudents = null;
    }
    if (unsubscribeStudent) {
      unsubscribeStudent();
      unsubscribeStudent = null;
    }
    // The archive stream is admin-only. Without this it would outlive the
    // session and fire a permission-denied toast for the next signed-in user.
    if (unsubscribeArchives) {
      unsubscribeArchives();
      unsubscribeArchives = null;
    }
  }
});

/* ========================================
   GOOGLE SIGN-IN
   ======================================== */
googleSignInBtn.addEventListener("click", async () => {
  try {
    googleSignInBtn.disabled = true;
    googleSignInBtn.textContent = "Signing in...";
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Sign-in error:", error);
    showToast("Failed to sign in. Please try again.", "error");
    googleSignInBtn.disabled = false;
    resetGoogleBtn();
  }
});

function resetGoogleBtn() {
  googleSignInBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M19.6 10.227C19.6 9.518 19.536 8.837 19.418 8.182H10V12.05H15.382C15.1506 13.3 14.4458 14.359 13.386 15.068V17.578H16.618C18.509 15.836 19.6 13.273 19.6 10.227Z" fill="#4285F4"/>
      <path d="M10 20C12.7 20 14.964 19.104 16.618 17.578L13.386 15.068C12.491 15.668 11.346 16.023 10 16.023C7.395 16.023 5.191 14.263 4.404 11.9H1.064V14.491C2.709 17.759 6.092 20 10 20Z" fill="#34A853"/>
      <path d="M4.404 11.9C4.204 11.3 4.091 10.659 4.091 10C4.091 9.341 4.204 8.7 4.404 8.1V5.509H1.064C0.384 6.859 0 8.386 0 10C0 11.614 0.384 13.141 1.064 14.491L4.404 11.9Z" fill="#FBBC05"/>
      <path d="M10 3.977C11.468 3.977 12.786 4.482 13.823 5.473L16.691 2.605C14.959 0.991 12.7 0 10 0C6.092 0 2.709 2.241 1.064 5.509L4.404 8.1C5.191 5.737 7.395 3.977 10 3.977Z" fill="#E94235"/>
    </svg>
    Sign in with Google`;
}

/* ========================================
   SIGN OUT
   ======================================== */
logoutBtn.addEventListener("click", () => signOut(auth));
logoutFromDeniedBtn.addEventListener("click", () => signOut(auth));

/* Copy UID helper */
const copyUidBtn = document.getElementById("copyUidBtn");
if (copyUidBtn) {
  copyUidBtn.addEventListener("click", async () => {
    const uid = document.getElementById("userUidDisplay")?.textContent;
    if (uid && uid !== "Loading...") {
      try {
        await navigator.clipboard.writeText(uid);
        showToast("UID copied to clipboard!", "success");
      } catch {
        const ta = document.createElement("textarea");
        ta.value = uid;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        showToast("UID copied to clipboard!", "success");
      }
    }
  });
}

/* ========================================
   STUDENT VIEW
   ======================================== */
function showStudentView() {
  loginScreen.style.display = "none";
  dashboardScreen.style.display = "flex";
  dashboardView.style.display = "none";
  manageView.style.display = "none";
  teachersView.style.display = "none";
  logView.style.display = "none";
  scoreboardView.style.display = "none";
  archiveView.style.display = "none";
  accessDenied.style.display = "none";
  studentView.style.display = "block";
  userAvatar.src = currentUser?.photoURL || "";
  userAvatar.style.display = currentUser?.photoURL ? "block" : "none";
  userEmail.textContent = currentUser?.email || "";

  // Students only see their own points — hide all management buttons
  manageToggleBtn.style.display = "none";
  teachersToggleBtn.style.display = "none";
  logToggleBtn.style.display = "none";
  scoreboardToggleBtn.style.display = "none";
  archiveToggleBtn.style.display = "none";

  renderStudentView();
}

function renderStudentView() {
  const s = currentStudent;
  if (!s) return;

  studentProfileHonor.textContent = s.merits || 0;
  studentProfileUniform.textContent = s.uniformPoints || 0;
  studentProfileEmpty.style.display = "none";
}

function setupStudentListener() {
  if (unsubscribeStudent) unsubscribeStudent();

  const q = query(
    collection(db, "students"),
    where("email", "==", currentUser.email.toLowerCase()),
    limit(1)
  );

  unsubscribeStudent = onSnapshot(
    q,
    (snap) => {
      if (!snap.empty) {
        currentStudent = { id: snap.docs[0].id, ...snap.docs[0].data() };
        renderStudentView();
      } else {
        currentStudent = null;
        studentProfileEmpty.style.display = "";
      }
    },
    (error) => {
      console.error("Student listener error:", error);
    }
  );
}

/* ========================================
   CHECK IF USER IS ALLOWED
   ======================================== */
async function checkIfAllowed(email) {
  try {
    // Document ID is the teacher's email (lowercased)
    const userRef = doc(db, "allowedUsers", email.toLowerCase());
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      currentUserRole = userSnap.data().role || null;
      currentUserHomeroom = userSnap.data().homeroom || null;
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error checking allowed users:", error);
    return false;
  }
}

/* ========================================
   FIND STUDENT BY EMAIL
   ======================================== */
async function findStudentByEmail(email) {
  try {
    const q = query(
      collection(db, "students"),
      where("email", "==", email.toLowerCase()),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return { id: snap.docs[0].id, ...snap.docs[0].data() };
    }
    return null;
  } catch (error) {
    console.error("Error finding student:", error);
    return null;
  }
}

/* ========================================
   UI STATE HELPERS
   ======================================== */
function showLogin() {
  loginScreen.style.display = "flex";
  dashboardScreen.style.display = "none";
  googleSignInBtn.disabled = false;
  resetGoogleBtn();
}

function showDashboardView() {
  loginScreen.style.display = "none";
  dashboardScreen.style.display = "flex";
  dashboardView.style.display = "block";
  manageView.style.display = "none";
  teachersView.style.display = "none";
  logView.style.display = "none";
  scoreboardView.style.display = "none";
  archiveView.style.display = "none";
  accessDenied.style.display = "none";
  userAvatar.src = currentUser?.photoURL || "";
  userAvatar.style.display = currentUser?.photoURL ? "block" : "none";
  userEmail.textContent = currentUser?.email || "";

  // Restore management buttons in header (admin only for Students/Teachers/Log)
  manageToggleBtn.style.display = isAdmin() ? "" : "none";
  teachersToggleBtn.style.display = isAdmin() ? "" : "none";
  logToggleBtn.style.display = isAdmin() ? "" : "none";
  archiveToggleBtn.style.display = isAdmin() ? "" : "none";
  scoreboardToggleBtn.style.display = "";
  studentView.style.display = "none";

  showLoading();
}

function showLoading() {
  loadingState.style.display = "flex";
  emptyState.style.display = "none";
  errorState.style.display = "none";
  studentGrid.style.display = "none";
}

function showAccessDenied() {
  loginScreen.style.display = "none";
  dashboardScreen.style.display = "flex";
  dashboardView.style.display = "none";
  manageView.style.display = "none";
  teachersView.style.display = "none";
  logView.style.display = "none";
  scoreboardView.style.display = "none";
  archiveView.style.display = "none";
  studentView.style.display = "none";
  loadingState.style.display = "none";
  emptyState.style.display = "none";
  errorState.style.display = "none";
  studentGrid.style.display = "none";
  accessDenied.style.display = "flex";
  userAvatar.src = currentUser?.photoURL || "";
  userAvatar.style.display = currentUser?.photoURL ? "block" : "none";
  userEmail.textContent = currentUser?.email || "";

  // Hide management buttons in header — unauthorized users must not see them
  manageToggleBtn.style.display = "none";
  teachersToggleBtn.style.display = "none";
  logToggleBtn.style.display = "none";
  scoreboardToggleBtn.style.display = "none";
  archiveToggleBtn.style.display = "none";

  const uidDisplay = document.getElementById("userUidDisplay");
  if (uidDisplay && currentUser) {
    uidDisplay.textContent = currentUser.uid;
  }
}

function showError(msg) {
  loadingState.style.display = "none";
  emptyState.style.display = "none";
  errorState.style.display = "flex";
  errorMessage.textContent = msg;
  studentGrid.style.display = "none";
}

retryBtn.addEventListener("click", () => {
  showLoading();
  setupRealTimeListener();
});

/* ========================================
   VIEW TOGGLING
   ======================================== */
manageToggleBtn.addEventListener("click", () => {
  if (!isAdmin()) { showToast("Only the admin can manage students.", "error"); return; }
  dashboardView.style.display = "none";
  teachersView.style.display = "none";
  logView.style.display = "none";
  scoreboardView.style.display = "none";
  archiveView.style.display = "none";
  if (unsubscribeTeachers) { unsubscribeTeachers(); unsubscribeTeachers = null; }
  if (unsubscribeLog) { unsubscribeLog(); unsubscribeLog = null; }
  if (unsubscribeArchives) { unsubscribeArchives(); unsubscribeArchives = null; }
  manageView.style.display = "block";
  renderManageStudentList();
});

backToDashboardBtn.addEventListener("click", () => {
  manageView.style.display = "none";
  dashboardView.style.display = "block";
});

/* ========================================
   SCOREBOARD VIEW TOGGLING
   ======================================== */
scoreboardToggleBtn.addEventListener("click", () => {
  dashboardView.style.display = "none";
  manageView.style.display = "none";
  teachersView.style.display = "none";
  logView.style.display = "none";
  archiveView.style.display = "none";
  if (unsubscribeTeachers) { unsubscribeTeachers(); unsubscribeTeachers = null; }
  if (unsubscribeLog) { unsubscribeLog(); unsubscribeLog = null; }
  if (unsubscribeArchives) { unsubscribeArchives(); unsubscribeArchives = null; }
  scoreboardView.style.display = "block";
  renderScoreboard();
});

backFromScoreboardBtn.addEventListener("click", () => {
  scoreboardView.style.display = "none";
  dashboardView.style.display = "block";
});

/* Scoreboard tabs — Honors / Uniform */
document.querySelectorAll(".scoreboard-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    scoreboardType = tab.dataset.scoreboardType === "uniform" ? "uniform" : "honor";
    renderScoreboard();
  });
});

/* ========================================
   LOG VIEW TOGGLING
   ======================================== */
logToggleBtn.addEventListener("click", () => {
  if (!isAdmin()) { showToast("Only the admin can view logs.", "error"); return; }
  dashboardView.style.display = "none";
  manageView.style.display = "none";
  teachersView.style.display = "none";
  scoreboardView.style.display = "none";
  archiveView.style.display = "none";
  if (unsubscribeTeachers) { unsubscribeTeachers(); unsubscribeTeachers = null; }
  if (unsubscribeArchives) { unsubscribeArchives(); unsubscribeArchives = null; }
  logView.style.display = "block";
  populateLogStudentFilter();
  setupLogListener();
});

backFromLogBtn.addEventListener("click", () => {
  logView.style.display = "none";
  dashboardView.style.display = "block";
  if (unsubscribeLog) { unsubscribeLog(); unsubscribeLog = null; }
});

/* ========================================
   TEACHERS VIEW TOGGLING
   ======================================== */
teachersToggleBtn.addEventListener("click", () => {
  if (!isAdmin()) { showToast("Only the admin can manage teachers.", "error"); return; }
  dashboardView.style.display = "none";
  manageView.style.display = "none";
  logView.style.display = "none";
  scoreboardView.style.display = "none";
  archiveView.style.display = "none";
  if (unsubscribeLog) { unsubscribeLog(); unsubscribeLog = null; }
  if (unsubscribeArchives) { unsubscribeArchives(); unsubscribeArchives = null; }
  teachersView.style.display = "block";
  setupTeachersListener();
});

backFromTeachersBtn.addEventListener("click", () => {
  teachersView.style.display = "none";
  dashboardView.style.display = "block";
  if (unsubscribeTeachers) { unsubscribeTeachers(); unsubscribeTeachers = null; }
});

/* ========================================
   REAL-TIME STUDENT LISTENER
   ======================================== */
function setupRealTimeListener() {
  if (unsubscribeStudents) unsubscribeStudents();

  const studentsRef = collection(db, "students");
  const q = query(studentsRef, orderBy("name"));

  unsubscribeStudents = onSnapshot(
    q,
    (snapshot) => {
      const students = [];
      snapshot.forEach((d) => students.push({ id: d.id, ...d.data() }));
      allStudents = students;
      populateClassFilter();
      populateLogStudentFilter();

      if (students.length === 0) {
        showEmptyState();
        return;
      }

      renderStudents(students);
      loadingState.style.display = "none";
      emptyState.style.display = "none";
      errorState.style.display = "none";
      studentGrid.style.display = "grid";

      // Also refresh management list if visible
      if (manageView.style.display === "block") {
        renderManageStudentList();
      }
    },
    (error) => {
      console.error("Firestore listener error:", error);
      showError("Failed to load student data. Check your network connection and ensure Firestore is initialized.");
    }
  );
}

function showEmptyState() {
  loadingState.style.display = "none";
  emptyState.style.display = "flex";
  errorState.style.display = "none";
  studentGrid.style.display = "none";
}

/* ========================================
   RENDER DASHBOARD STUDENT GRID
   ======================================== */
// Module-scope comparator so the sort doesn't allocate a closure per render.
const compareByName = (a, b) =>
  (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });

function renderStudents(students) {
  // Filter by selected house and class if active
  let filtered = [...students];
  if (selectedHouse) {
    filtered = filtered.filter((s) => s.house === selectedHouse);
  }
  if (selectedClass) {
    filtered = filtered.filter((s) => (s.className || "") === selectedClass);
  }

  // Sort: by name by default; by points (honor or uniform) when selected
  filtered.sort((a, b) => {
    if (sortBy === "name") return compareByName(a, b);
    const field = sortBy === "uniform" ? "uniformPoints" : "merits";
    const diff = (b[field] || 0) - (a[field] || 0);
    return diff !== 0 ? diff : compareByName(a, b);
  });

  // Show/hide filter indicator
  if (selectedHouse || selectedClass) {
    const count = filtered.length;
    const parts = [];
    if (selectedHouse) parts.push(`${HOUSE_EMOJIS[selectedHouse]} <strong>${selectedHouse}</strong>`);
    if (selectedClass) parts.push(`Class <strong>${escapeHtml(selectedClass)}</strong>`);
    filterIndicator.style.display = "flex";
    filterLabel.innerHTML = `${parts.join(" · ")} — ${count} student${count !== 1 ? "s" : ""}`;
  } else {
    filterIndicator.style.display = "none";
  }

  if (filtered.length === 0) {
    studentGrid.innerHTML = `<div class="empty-state" style="display:flex;padding:40px 20px;">
      <p style="font-size:0.9rem;color:var(--color-text-tertiary);">No students match the current filters.</p>
    </div>`;
    return;
  }

  const pointLabel = pointType === "uniform" ? "uniform" : "behaviour";

  studentGrid.innerHTML = filtered
    .map((student) => {
      const key = student.house.toLowerCase();
      const initials = student.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
      return `
        <div class="student-card student-card-${key}" id="student-${student.id}">
          <div class="student-avatar student-avatar-${key}">${initials}</div>
          <div class="student-info student-info-clickable" data-history-student-id="${student.id}" title="View ${escapeAttr(student.name)}'s point history">
            <div class="student-name">${escapeHtml(student.name)}</div>
            <span class="student-house-badge house-badge-${key}">${student.house}</span>
            ${student.className ? `<span class="student-class-badge">${escapeHtml(student.className)}</span>` : ''}
          </div>
          <div class="student-points">
            <div class="point-controls">
              ${isAdmin() ? `<button class="merit-btn merit-btn-minus" data-type="${pointType}" data-student-id="${student.id}" data-student-name="${escapeAttr(student.name)}" data-house="${student.house}" title="Remove ${pointLabel} point from ${escapeAttr(student.name)}">−</button>` : ''}
              <span class="merit-count" id="${pointType}-${student.id}">${pointType === "uniform" ? (student.uniformPoints || 0) : (student.merits || 0)}</span>
              <button class="merit-btn merit-btn-plus" data-type="${pointType}" data-student-id="${student.id}" data-student-name="${escapeAttr(student.name)}" data-house="${student.house}" title="Give ${pointLabel} point to ${escapeAttr(student.name)}">+</button>
              ${canGive10Points() ? `<button class="merit-btn merit-btn-plus10" data-type="${pointType}" data-student-id="${student.id}" data-student-name="${escapeAttr(student.name)}" data-house="${student.house}" title="Give 10 ${pointLabel} points (admin / house leader only)">+10</button>` : ''}
            </div>
          </div>
        </div>`;
    })
    .join("");

}

// One delegated listener set for the whole grid. The cards are rebuilt with
// innerHTML on every snapshot, so per-button listeners meant re-attaching
// ~4 handlers per student (plus document-wide scans) on every data change.
studentGrid.addEventListener("click", (e) => {
  const info = e.target.closest(".student-info-clickable");
  if (info) {
    openStudentHistory(info.dataset.historyStudentId);
    return;
  }
  const btn = e.target.closest(".merit-btn");
  if (btn) handlePointClick(btn);
});

/* ========================================
   GRID POINT TYPE TABS — Honor / Uniform
   ======================================== */
// Uniform points may only be awarded during the window defined by the
// UNIFORM_WINDOW_* constants above (in Bangkok local time).
function bkkClock() {
  // Shift the epoch to Bangkok wall-clock, then read the shifted UTC parts.
  const shifted = new Date(Date.now() + BANGKOK_UTC_OFFSET_MIN * 60000);
  return {
    day: shifted.getUTCDay(),                                   // 0=Sun .. 6=Sat
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() // 0..1439
  };
}

function isUniformWindow() {
  const { day, minutes } = bkkClock();
  return UNIFORM_WINDOW_WEEKDAYS.includes(day)
      && minutes >= UNIFORM_WINDOW_START_MIN
      && minutes <  UNIFORM_WINDOW_END_MIN;
}

// Bangkok calendar day number (whole days since the Unix epoch in UTC+7). This
// is stamped onto the student doc (uniformDay) every time a uniform award is
// granted, so both the client and the security rules can cheaply tell whether
// the student has already received a uniform award today. Must stay in sync
// with todayBkkDay() in firestore.rules.
function bkkDayNumber() {
  return Math.floor((Date.now() + BANGKOK_UTC_OFFSET_MIN * 60000) / 86400000);
}

// Enable/disable the Uniform tab, and drop back to the Behaviour view if the
// window closes while the user is on the Uniform tab. Admins may award uniform
// points at any time, so their tab is always enabled.
function applyUniformTabAvailability() {
  const available = isUniformWindow() || isAdmin();
  document.querySelectorAll(".grid-tab").forEach((tab) => {
    const isUniformTab = tab.dataset.pointType === "uniform";
    if (!isUniformTab) return;
    tab.disabled = !available;
    tab.title = available
      ? (isAdmin()
          ? "Uniform points — admins may award any time"
          : "Uniform points — max 1 per student per day")
      : "Uniform points are available Mon, Tue, Wed & Fri 07:00–07:30 (Bangkok time)";
  });

  // If the window just closed while we were on the Uniform tab, revert.
  // (Admins keep the tab; their availability never lapses.)
  if (!available && !isAdmin() && pointType === "uniform") {
    pointType = "honor";
    document.querySelectorAll(".grid-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.pointType === "honor");
    });
    renderStudents(allStudents);
  }
}

// Homeroom teachers signing in during the uniform window (Mon, Tue, Wed &
// Fri 07:00–07:30 Bangkok) start with the Uniform tab and their homeroom
// class already selected — the morning round is then two taps per student.
function applyHomeroomDefaults() {
  if (!currentUserHomeroom || !isUniformWindow()) return;
  pointType = "uniform";
  document.querySelectorAll(".grid-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.pointType === "uniform");
  });
  selectedClass = currentUserHomeroom;
  // The <select> may not have options yet (the roster arrives with the first
  // snapshot) — populateClassFilter syncs it from selectedClass when it does.
  if ([...classFilterSelect.options].some((o) => o.value === selectedClass)) {
    classFilterSelect.value = selectedClass;
  }
  renderStudents(allStudents);
}

// Re-check at page load and regularly so the button flips at 07:00 / 07:30
// without needing a refresh.
document.addEventListener("DOMContentLoaded", () => {
  applyUniformTabAvailability();
  setInterval(applyUniformTabAvailability, 30 * 1000); // every 30s
});

document.querySelectorAll(".grid-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.pointType === "uniform" && !isUniformWindow() && !isAdmin()) {
      showToast("Uniform points are only available Mon, Tue, Wed & Fri 07:00–07:30 (Bangkok time).", "error");
      return;
    }
    pointType = tab.dataset.pointType === "uniform" ? "uniform" : "honor";
    document.querySelectorAll(".grid-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.pointType === pointType);
    });
    renderStudents(allStudents);
  });
});

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

// String escaping without allocating a DOM element on every call — this runs
// for every field of every row in the render loops.
function escapeHtml(text) {
  const str = text === null || text === undefined ? "" : String(text);
  return str.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch]);
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ========================================
   CLASS FILTER — POPULATE OPTIONS
   ======================================== */
let classFilterSignature = "";

function populateClassFilter() {
  const classes = [...new Set(
    allStudents.map((s) => (s.className || "").trim()).filter(Boolean)
  )].sort();

  // Called on every snapshot — skip the rebuild when the class list is
  // unchanged so the DOM (and an open dropdown) isn't needlessly reset.
  const signature = classes.join("\u0000");
  if (signature === classFilterSignature) return;
  classFilterSignature = signature;

  const current = classFilterSelect.value;
  classFilterSelect.innerHTML =
    `<option value="">All Classes</option>` +
    classes.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");

  // Restore the active filter — including a homeroom class that has no
  // students yet (e.g. assigned before the roster is imported), which just
  // gets an extra option so the selection stays visible.
  const desired = selectedClass || current;
  if (desired && !classes.includes(desired)) {
    classFilterSelect.insertAdjacentHTML(
      "beforeend",
      `<option value="${escapeAttr(desired)}">${escapeHtml(desired)}</option>`
    );
  }
  classFilterSelect.value = desired || "";
  selectedClass = desired || null;
}

classFilterSelect.addEventListener("change", () => {
  const val = classFilterSelect.value;
  // Toggle: selecting the same class deselects it
  if (val === selectedClass) {
    selectedClass = null;
    classFilterSelect.value = "";
  } else {
    selectedClass = val || null;
  }
  renderStudents(allStudents);
});

sortFilterSelect.addEventListener("change", () => {
  sortBy = sortFilterSelect.value;
  renderStudents(allStudents);
});

/* ========================================
   HOUSE FILTER — toolbar dropdown
   ======================================== */
houseFilterSelect.addEventListener("change", () => {
  selectedHouse = houseFilterSelect.value || null;
  renderStudents(allStudents);
});

/* ========================================
   CLEAR FILTER
   ======================================== */
clearFilterBtn.addEventListener("click", () => {
  selectedHouse = null;
  selectedClass = null;
  houseFilterSelect.value = "";
  classFilterSelect.value = "";
  renderStudents(allStudents);
});

/* ========================================
   SCOREBOARD — FULL PAGE HOUSE RANKING
   ======================================== */
function renderScoreboard() {
  const students = allStudents;
  const field = scoreboardType === "uniform" ? "uniformPoints" : "merits";
  const label = scoreboardType === "uniform" ? "Uniform" : "Behaviour Points";

  // Highlight the active tab
  document.querySelectorAll(".scoreboard-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.scoreboardType === scoreboardType);
  });

  if (students.length === 0) {
    scoreboardContent.innerHTML = `
      <div class="empty-state" style="display:flex;padding:60px 20px;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
        </svg>
        <h3>No Data Yet</h3>
        <p>Add students and award points to see the scoreboard.</p>
      </div>`;
    return;
  }

  // Compute totals per house
  const houseData = {};
  for (const house of HOUSES) {
    const members = students.filter((s) => s.house === house);
    const total = members.reduce((s, st) => s + (st[field] || 0), 0);
    const avg = members.length > 0 ? Math.round(total / members.length) : 0;
    houseData[house] = { total, count: members.length, avg };
  }

  // Sort by merits descending
  const sorted = Object.entries(houseData)
    .filter(([, d]) => d.count > 0)
    .sort(([, a], [, b]) => b.total - a.total);

  if (sorted.length === 0) {
    scoreboardContent.innerHTML = `
      <div class="empty-state" style="display:flex;padding:60px 20px;">
        <p style="font-size:0.9rem;color:var(--color-text-tertiary);">No houses have students yet.</p>
      </div>`;
    return;
  }

  const maxTotal = Math.max(...sorted.map(([, d]) => d.total), 1);

  const medals = ["🥇", "🥈", "🥉"];

  scoreboardContent.innerHTML = sorted
    .map(([house, data], i) => {
      const rank = i + 1;
      const key = house.toLowerCase();
      const pct = Math.max((data.total / maxTotal) * 100, 4);
      return `
        <div class="scoreboard-card scoreboard-card-${key}">
          <div class="scoreboard-rank scoreboard-rank-${rank}">${rank <= 3 ? medals[i] : `#${rank}`}</div>
          <span class="scoreboard-emoji">${HOUSE_EMOJIS[house]}</span>
          <div class="scoreboard-info">
            <div class="scoreboard-name">${house}</div>
            <div class="scoreboard-stats">
              <span class="scoreboard-stat"><strong>${data.count}</strong> student${data.count !== 1 ? "s" : ""}</span>
              <span class="scoreboard-stat"><strong>${data.avg}</strong> avg / student</span>
            </div>
          </div>
          <div class="scoreboard-bar-wrap">
            <div class="scoreboard-bar-label">
              <span>of ${maxTotal}</span>
              <span>${Math.round(pct)}%</span>
            </div>
            <div class="scoreboard-bar-track">
              <div class="scoreboard-bar-fill scoreboard-bar-fill-${key}" style="width: ${pct}%"></div>
            </div>
          </div>
          <div class="scoreboard-merits">
            <div class="scoreboard-merit-number">${data.total}</div>
            <div class="scoreboard-merit-label">${label}</div>
          </div>
        </div>`;
    })
    .join("");
}

/* ========================================
   AWARD / REMOVE POINTS (honor or uniform)
   ======================================== */
async function handlePointClick(btn) {
  const studentId = btn.dataset.studentId;
  const studentName = btn.dataset.studentName;
  const house = btn.dataset.house || "";
  const student = allStudents.find((s) => s.id === studentId);
  const type = btn.dataset.type === "uniform" ? "uniform" : "honor";
  const isMinus = btn.classList.contains("merit-btn-minus");
  const isPlus10 = btn.classList.contains("merit-btn-plus10");
  const change = isMinus ? -1 : (isPlus10 ? 10 : 1);
  const label = type === "uniform" ? "uniform point" : "behaviour point";
  const pluralLabel = Math.abs(change) === 1 ? label : label + "s";
  const isUniformGrant = type === "uniform" && change > 0;

  // +10 is restricted to admins and house leaders (LH).
  if (isPlus10 && !canGive10Points()) {
    showToast("Only admins or house leaders can give 10 points.", "error");
    return;
  }

  // +10 is a bulk award — always confirm so accidental taps can't fire it.
  if (isPlus10) {
    const ok = confirm(
      `Give 10 ${pluralLabel} to ${studentName} (${house || "no house"})?\n\nType: ${type === "uniform" ? "Uniform" : "Behaviour Point"}\nThis will be recorded in the activity log.`
    );
    if (!ok) return;
  }

  // A student may receive at most ONE uniform award per day (Bangkok time).
  // The check against the live snapshot gives instant feedback; the real guard
  // is the transaction below plus the uniformDay rule in firestore.rules, so
  // neither a double click nor two teachers awarding at once can both get
  // through. Admins are exempt — they may grant uniform points any time,
  // repeatedly (the transaction still stamps uniformDay so a teacher's
  // once-a-day limit keeps counting the admin's award).
  if (isUniformGrant && !isAdmin()) {
    if (student && student.uniformDay === bkkDayNumber()) {
      showToast(`${studentName} has already received a uniform point today.`, "error");
      return;
    }
  }

  // Minus buttons can't go below zero
  if (isMinus) {
    const current = type === "uniform" ? (student?.uniformPoints || 0) : (student?.merits || 0);
    if (!student || current <= 0) {
      showToast(`${studentName} has no ${label}s to remove.`, "error");
      return;
    }
  }

  btn.disabled = true;
  try {
    if (isUniformGrant) {
      await awardUniformPoint(studentId, change, studentName, house);
    } else {
      const update = type === "uniform"
        ? { uniformPoints: increment(change) }
        : { merits: increment(change) };
      // One atomic batch = fewer round-trips and guarantees the log entry is
      // written only when the points update succeeds.
      const batch = writeBatch(db);
      batch.update(doc(db, "students", studentId), update);
      batch.set(doc(collection(db, "meritLog")), buildLogEntry({
        studentId,
        studentName,
        house,
        type,
        change
      }));
      await batch.commit();
    }

    const countEl = document.getElementById(`${type}-${studentId}`);
    if (countEl) {
      countEl.classList.remove("merit-pop");
      void countEl.offsetWidth;
      countEl.classList.add("merit-pop");
    }
    showToast(change > 0 ? `+${change} ${pluralLabel} for ${studentName}! 🎉` : `-${Math.abs(change)} ${pluralLabel} for ${studentName}`, change > 0 ? "success" : "info");
    setTimeout(() => { btn.disabled = false; }, 400);
  } catch (error) {
    // The server rejected the award because the student already received one
    // today — e.g. a race with a second click or another teacher.
    if (error && error.message === "UNIFORM_ALREADY_AWARDED") {
      showToast(`${studentName} has already received a uniform point today.`, "error");
    } else {
      console.error("Error updating points:", error);
      showToast("Failed to update points. Please try again.", "error");
    }
    btn.disabled = false;
  }
}

// Grant uniform points atomically. The student-doc read and the increment +
// uniformDay stamp run inside a single transaction, so two rapid clicks or two
// teachers awarding at the same time cannot both pass the daily check.
// firestore.rules enforces the same invariant server-side. Admins skip the
// daily check (they may award any time) but still stamp uniformDay, so the
// once-per-day limit for teachers keeps counting the admin's award.
async function awardUniformPoint(studentId, change, studentName, house) {
  const studentRef = doc(db, "students", studentId);
  const adminBypass = isAdmin();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(studentRef);
    const data = snap.data() || {};
    if (!adminBypass && data.uniformDay === bkkDayNumber()) {
      // Abort with a sentinel error the caller maps back to a friendly toast.
      throw new Error("UNIFORM_ALREADY_AWARDED");
    }
    tx.update(studentRef, {
      uniformPoints: increment(change),
      uniformDay: bkkDayNumber()
    });
    tx.set(doc(collection(db, "meritLog")), buildLogEntry({
      studentId,
      studentName,
      house,
      type: "uniform",
      change
    }));
  });
}

/* ========================================
   TEACHERS — REAL-TIME LISTENER
   ======================================== */
function setupTeachersListener() {
  if (unsubscribeTeachers) unsubscribeTeachers();

  const teachersRef = collection(db, "allowedUsers");

  unsubscribeTeachers = onSnapshot(
    teachersRef,
    (snapshot) => {
      const teachers = [];
      snapshot.forEach((d) => {
        const data = d.data() || {};
        teachers.push({ id: d.id, email: data.email || "—", role: data.role || "", homeroom: data.homeroom || "" });
      });
      renderTeacherList(teachers);
    },
    (error) => {
      console.error("Teachers listener error:", error);
      showToast("Failed to load teacher list.", "error");
    }
  );
}  function renderTeacherList(teachers) {
  teacherCount.textContent = teachers.length;

  if (teachers.length === 0) {
    teacherTableBody.innerHTML = `<tr><td colspan="4" class="student-table-empty">No teachers added yet.</td></tr>`;
    return;
  }

  // Homeroom choices come from the classes students are actually in; a
  // teacher's current homeroom stays selectable even if it has no students.
  const knownClasses = [...new Set(
    allStudents.map((s) => (s.className || "").trim()).filter(Boolean)
  )].sort();

  teacherTableBody.innerHTML = teachers
    .map((t) => {
      const choices = t.homeroom && !knownClasses.includes(t.homeroom)
        ? [...knownClasses, t.homeroom].sort()
        : knownClasses;
      return `
      <tr>
        <td>${escapeHtml(t.email)}</td>
        <td>${escapeHtml(roleLabel(t.role))}</td>
        <td>
          <select class="form-select homeroom-select" data-teacher-email="${escapeAttr(t.id)}" title="Homeroom class for ${escapeAttr(t.email)}">
            <option value="">— none —</option>
            ${choices.map((c) => `<option value="${escapeAttr(c)}"${c === t.homeroom ? " selected" : ""}>${escapeHtml(c)}</option>`).join("")}
          </select>
        </td>
        <td style="width:60px;">
          <button class="btn-icon delete-teacher-btn" data-teacher-email="${escapeAttr(t.id)}" title="Remove ${escapeAttr(t.email)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </td>
      </tr>`;
    })
    .join("");

  // (row handlers are delegated on teacherTableBody — see below)
}

// One delegated listener for the teacher table — its rows are rebuilt with
// innerHTML on every snapshot, so per-button handlers meant a re-attach sweep
// on each update.
teacherTableBody.addEventListener("click", async (e) => {
  const btn = e.target.closest(".delete-teacher-btn");
  if (!btn) return;
  if (!isAdmin()) { showToast("Only the admin can remove teachers.", "error"); return; }
  const email = btn.dataset.teacherEmail;
  if (email.toLowerCase() === currentUser?.email?.toLowerCase()) {
    showToast("You cannot remove yourself!", "error");
    return;
  }
  if (confirm(`Remove ${email} from authorized teachers?`)) {
    try {
      await deleteDoc(doc(db, "allowedUsers", email));
      showToast(`Removed ${email}.`, "info");
    } catch (error) {
      console.error("Error removing teacher:", error);
      showToast("Failed to remove teacher. Please try again.", "error");
    }
  }
});

// Homeroom assignment (admin only) — saved straight to the teacher's
// allowedUsers doc; the teacher picks it up on their next sign-in.
teacherTableBody.addEventListener("change", async (e) => {
  const sel = e.target.closest(".homeroom-select");
  if (!sel) return;
  if (!isAdmin()) {
    showToast("Only the admin can change homeroom classes.", "error");
    return;
  }
  const email = sel.dataset.teacherEmail;
  const homeroom = sel.value || "";
  try {
    await updateDoc(doc(db, "allowedUsers", email), { homeroom });
    showToast(
      homeroom ? `Homeroom for ${email}: ${homeroom} ✅` : `Homeroom cleared for ${email}.`,
      "success"
    );
  } catch (error) {
    console.error("Error setting homeroom:", error);
    showToast("Failed to set homeroom. Please try again.", "error");
  }
});

/* ========================================
   HOME LINK — click logo to go to dashboard
   ======================================== */
document.getElementById("homeLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  manageView.style.display = "none";
  teachersView.style.display = "none";
  logView.style.display = "none";
  scoreboardView.style.display = "none";
  archiveView.style.display = "none";
  dashboardView.style.display = "block";
  if (unsubscribeTeachers) { unsubscribeTeachers(); unsubscribeTeachers = null; }
  if (unsubscribeLog) { unsubscribeLog(); unsubscribeLog = null; }
  if (unsubscribeArchives) { unsubscribeArchives(); unsubscribeArchives = null; }
});

/* ========================================
   RESET ALL MERITS (admin only)
   ======================================== */
document.getElementById("resetMeritsBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;
  const count = allStudents.length;
  if (count === 0) { showToast("No students to reset.", "error"); return; }
  if (!confirm(`Reset ALL behaviour and uniform points for ${count} student${count !== 1 ? "s" : ""} to 0? This cannot be undone.`)) return;

  const btn = document.getElementById("resetMeritsBtn");
  btn.disabled = true;
  btn.textContent = `Resetting ${count}...`;

  try {
    const batch = writeBatch(db);
    for (const student of allStudents) {
      const ref = doc(db, "students", student.id);
      batch.update(ref, { merits: 0, uniformPoints: 0 });
    }
    await batch.commit();
    showToast(`Reset points for all ${count} students! ✅`, "success");
  } catch (error) {
    console.error("Error resetting merits:", error);
    showToast("Failed to reset merits. Please try again.", "error");
  }

  btn.disabled = false;
  btn.textContent = "Reset All Merits";
});

/* ========================================
   TEACHERS — ADD TEACHER
   ======================================== */
addTeacherBtn.addEventListener("click", async () => {
  if (!isAdmin()) { showToast("Only the admin can add teachers.", "error"); return; }
  const email = teacherEmailInput.value.trim().toLowerCase();
  const role = teacherRoleSelect.value || "";

  if (!email) { showToast("Please enter the teacher's email.", "error"); return; }
  if (!email.includes("@")) { showToast("Please enter a valid email address.", "error"); return; }

  addTeacherBtn.disabled = true;
  addTeacherBtn.textContent = "Adding...";

  try {
    // Use email as the document ID; merge so re-adding a teacher never wipes
    // fields like their homeroom class.
    const ref = doc(db, "allowedUsers", email);
    await setDoc(ref, role ? { email, role } : { email }, { merge: true });
    showToast(`Added ${email} as an authorized teacher! ✅`, "success");
    teacherEmailInput.value = "";
  } catch (error) {
    console.error("Error adding teacher:", error);
    showToast("Failed to add teacher. Please try again.", "error");
  }

  addTeacherBtn.disabled = false;
  addTeacherBtn.textContent = "Add Teacher";
});

/* ========================================
   ACTIVITY LOG — REAL-TIME LISTENER
   ======================================== */
function setupLogListener() {
  if (unsubscribeLog) unsubscribeLog();

  const logRef = collection(db, "meritLog");
  const q = query(logRef, orderBy("timestamp", "desc"), limit(logLimit));

  unsubscribeLog = onSnapshot(
    q,
    (snapshot) => {
      allLogEntries = [];
      snapshot.forEach((d) => allLogEntries.push({ id: d.id, ...d.data() }));
      // If we filled the whole page, older entries may still exist.
      logHasMore = snapshot.size >= logLimit;
      populateLogTeacherFilter(allLogEntries);
      renderLogList(allLogEntries);
    },
    (error) => {
      console.error("Log listener error:", error);
      showToast("Failed to load activity log.", "error");
    }
  );
}

function loadMoreLogs() {
  logLimit = Math.min(logLimit + 300, 2000);
  if (logLoadMoreBtn) {
    logLoadMoreBtn.disabled = true;
    logLoadMoreBtn.textContent = "Loading…";
  }
  setupLogListener();
  setTimeout(() => {
    if (logLoadMoreBtn) {
      logLoadMoreBtn.disabled = false;
      logLoadMoreBtn.textContent = "Load more";
    }
  }, 1500);
}

if (logLoadMoreBtn) {
  logLoadMoreBtn.addEventListener("click", loadMoreLogs);
}

// Midnight (local) of the given date, used for day-range filters.
function startOfDay(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

function logEntryDate(e) {
  if (!e.timestamp) return null;
  try {
    return e.timestamp.toDate ? e.timestamp.toDate() : new Date(e.timestamp);
  } catch {
    return null;
  }
}

function logDayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Build the date-filter predicate once per render. "Now" and the custom-day
// range are constant across entries, so recomputing them per row (plus parsing
// the custom value per row) is pure waste in the log filter loop.
function makeDateFilterMatcher() {
  if (logDateFilterValue === "all") return () => true;
  const dayMs = 86400000;
  const todayStart = startOfDay(new Date());
  if (logDateFilterValue === "custom") {
    if (!logDateCustomValue) return () => true;
    const [y, m, day] = logDateCustomValue.split("-").map(Number);
    if (!y || !m || !day) return () => true;
    const customStart = new Date(y, m - 1, day).getTime();
    return (d) => d.getTime() >= customStart && d.getTime() < customStart + dayMs;
  }
  if (logDateFilterValue === "today") return (d) => d.getTime() >= todayStart;
  if (logDateFilterValue === "yesterday") {
    return (d) => d.getTime() >= todayStart - dayMs && d.getTime() < todayStart;
  }
  if (logDateFilterValue === "last7") return (d) => d.getTime() >= todayStart - 6 * dayMs;
  if (logDateFilterValue === "last30") return (d) => d.getTime() >= todayStart - 29 * dayMs;
  return () => true;
}

function formatDayHeader(d, todayStart = startOfDay(new Date())) {
  const dayMs = 86400000;
  const thisStart = startOfDay(d);
  const diffDays = Math.round((todayStart - thisStart) / dayMs);
  let rel = "";
  if (diffDays === 0) rel = "Today";
  else if (diffDays === 1) rel = "Yesterday";
  else rel = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  const full = d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return diffDays <= 1 ? `${rel} · ${full}` : full;
}

let logStudentFilterSignature = "";

function populateLogStudentFilter() {
  if (!logStudentFilter) return;
  const previous = logStudentFilterValue || logStudentFilter.value || "";
  const sorted = [...allStudents].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));

  // Called on every snapshot — skip the rebuild when the roster is unchanged.
  const signature = sorted.map((s) => `${s.id}\u0000${s.name}\u0000${s.className || ""}`).join("\u0001");
  if (signature === logStudentFilterSignature) return;
  logStudentFilterSignature = signature;

  logStudentFilter.innerHTML =
    `<option value="">All students</option>` +
    sorted.map((s) => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}${s.className ? ` (${escapeHtml(s.className)})` : ""}</option>`).join("");
  logStudentFilterValue = sorted.some((s) => s.id === previous) ? previous : "";
  logStudentFilter.value = logStudentFilterValue;
}

if (logStudentFilter) {
  logStudentFilter.addEventListener("change", () => {
    logStudentFilterValue = logStudentFilter.value || "";
    renderLogList(allLogEntries);
  });
}

function populateLogTeacherFilter(entries) {
  if (!logTeacherFilter) return;
  const previous = logTeacherFilterValue || logTeacherFilter.value || "";
  const emails = [...new Set(
    entries.flatMap((e) => [e.teacherEmail, e.awardedBy]).filter(Boolean).map((m) => String(m).toLowerCase())
  )].sort();
  logTeacherFilter.innerHTML =
    `<option value="">All teachers</option>` +
    emails.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join("");
  logTeacherFilterValue = emails.includes(previous) ? previous : "";
  logTeacherFilter.value = logTeacherFilterValue;
}

if (logTeacherFilter) {
  logTeacherFilter.addEventListener("change", () => {
    logTeacherFilterValue = logTeacherFilter.value || "";
    renderLogList(allLogEntries);
  });
}

if (logTypeFilter) {
  logTypeFilter.addEventListener("change", () => {
    logTypeFilterValue = logTypeFilter.value || "";
    renderLogList(allLogEntries);
  });
}

if (logDateFilter) {
  logDateFilter.addEventListener("change", () => {
    logDateFilterValue = logDateFilter.value || "all";
    if (logDateInput) {
      logDateInput.style.display = logDateFilterValue === "custom" ? "" : "none";
      if (logDateFilterValue !== "custom") {
        logDateInput.value = "";
        logDateCustomValue = "";
      } else if (!logDateInput.value) {
        // Default the picker to today so "Pick a day" shows something.
        logDateInput.value = new Date().toISOString().slice(0, 10);
        logDateCustomValue = logDateInput.value;
      }
    }
    renderLogList(allLogEntries);
  });
}

if (logDateInput) {
  logDateInput.addEventListener("change", () => {
    logDateCustomValue = logDateInput.value || "";
    if (logDateFilter && logDateFilter.value !== "custom") {
      logDateFilter.value = "custom";
      logDateFilterValue = "custom";
    }
    renderLogList(allLogEntries);
  });
}

function formatTime(timestamp) {
  if (!timestamp) return "—";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatFullTime(timestamp) {
  if (!timestamp) return "Unknown time";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  try {
    return date.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  } catch {
    return String(date);
  }
}

function renderLogList(entries) {
  const dateMatcher = makeDateFilterMatcher();
  const checkDates = logDateFilterValue !== "all";
  const filtered = (entries || []).filter((e) => {
    if (logStudentFilterValue && (e.studentId || "") !== logStudentFilterValue) return false;
    if (logTeacherFilterValue) {
      const want = logTeacherFilterValue.toLowerCase();
      const teacher = String(e.teacherEmail || "").toLowerCase();
      const awarded = String(e.awardedBy || "").toLowerCase();
      if (teacher !== want && awarded !== want) return false;
    }
    if (logTypeFilterValue && (e.type || "honor") !== logTypeFilterValue) return false;
    if (checkDates) {
      // Pending/unknown timestamps only show under "All time".
      const d = logEntryDate(e);
      if (!d || !dateMatcher(d)) return false;
    }
    return true;
  });

  const hasFilter = logStudentFilterValue || logTeacherFilterValue || logTypeFilterValue || logDateFilterValue !== "all";
  const shown = hasFilter
    ? `${filtered.length} of ${entries.length}`
    : `${filtered.length}`;
  logCount.textContent = shown;

  // Footer: "Showing X" + Load more when older entries may exist beyond the limit.
  if (logLoadMoreWrap) {
    const showFooter = entries.length > 0 && (logHasMore || filtered.length !== entries.length);
    logLoadMoreWrap.style.display = showFooter ? "flex" : "none";
    if (logShowingStatus) {
      logShowingStatus.textContent = logHasMore
        ? `Showing latest ${entries.length} (older entries available)`
        : `Showing ${filtered.length} of ${entries.length}`;
    }
    if (logLoadMoreBtn) logLoadMoreBtn.style.display = logHasMore ? "" : "none";
  }

  if (filtered.length === 0) {
    const msg = entries.length === 0
      ? "No merit activity yet."
      : "No activity matches the selected filters.";
    logTableBody.innerHTML = `<tr><td colspan="8" class="student-table-empty">${msg}</td></tr>`;
    return;
  }

  // Group all-time history by calendar day so older logs are easy to scan.
  // Each entry's day key and the per-day totals are computed once up front
  // (O(n)) instead of re-filtering the whole list for every day header (O(n²)).
  const rows = filtered.map((e) => {
    const d = logEntryDate(e);
    return { e, d, dayKey: d ? logDayKey(d) : "unknown" };
  });
  const dayCounts = {};
  for (const r of rows) dayCounts[r.dayKey] = (dayCounts[r.dayKey] || 0) + 1;
  const todayStart = startOfDay(new Date());

  let html = "";
  let lastDayKey = null;
  for (const { e, d, dayKey } of rows) {
    if (dayKey !== lastDayKey) {
      lastDayKey = dayKey;
      const header = d ? formatDayHeader(d, todayStart) : "Unknown date";
      const count = dayCounts[dayKey];
      html += `<tr class="log-day-header"><td colspan="8">📅 ${escapeHtml(header)} — ${count} award${count !== 1 ? "s" : ""}</td></tr>`;
    }
    const type = e.type === "uniform" ? "uniform" : "honor";
    const typeLabel = type === "uniform" ? "Uniform" : "Behaviour Point";
    const change = typeof e.change === "number" ? e.change : null;
    const changeBadge = change === null
      ? "—"
      : `<span class="log-change ${change > 0 ? "log-change-plus" : change < 0 ? "log-change-minus" : ""}">${change > 0 ? "+" : ""}${change}</span>`;
    const credited = e.teacherEmail || "—";
    const awardedBy = e.awardedBy || "";
    const awardedCell = !awardedBy
      ? `<span style="color:var(--color-text-tertiary);">—</span>`
      : awardedBy.toLowerCase() === String(credited || "").toLowerCase()
        ? `${escapeHtml(awardedBy)} <span class="log-self-badge">self</span>`
        : `${escapeHtml(awardedBy)}${e.onBehalfOf ? ` <span class="log-behalf-badge">on behalf</span>` : ""}`;
    const detailTitle = [
      `Student: ${e.studentName || "—"} (${e.studentId || "—"})`,
      `House: ${e.house || "—"} · Class: ${e.studentClass || "—"}`,
      `Award: ${change !== null ? (change > 0 ? "+" : "") + change : "—"} ${typeLabel}`,
      `Credited teacher: ${credited}`,
      awardedBy ? `Awarded by: ${awardedBy}${e.awardedByRole ? ` (${e.awardedByRole})` : ""}` : "Awarded by: —",
      `At: ${formatFullTime(e.timestamp)}`
    ].join("\n");
    const timeCell = d
      ? `<div style="font-size:0.8rem;color:var(--color-text);white-space:nowrap;">${escapeHtml(d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }))}</div>
         <div style="font-size:0.7rem;color:var(--color-text-tertiary);white-space:nowrap;">${escapeHtml(d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))} · ${escapeHtml(formatTime(e.timestamp))}</div>`
      : `<span style="font-size:0.8rem;color:var(--color-text-tertiary);">—</span>`;
    html += `
      <tr title="${escapeAttr(detailTitle)}">
        <td>${escapeHtml(e.studentName || "—")}</td>
        <td>${e.house ? `<span class="house-dot house-dot-${e.house.toLowerCase()}"></span>${escapeHtml(e.house)}` : "—"}</td>
        <td>${e.studentClass ? escapeHtml(e.studentClass) : `<span style="color:var(--color-text-tertiary);">—</span>`}</td>
        <td style="white-space:nowrap;">${changeBadge}</td>
        <td>${typeLabel}</td>
        <td style="font-size:0.8rem;">${escapeHtml(credited)}</td>
        <td style="font-size:0.8rem;">${awardedCell}</td>
        <td style="white-space:nowrap;" title="${escapeAttr(formatFullTime(e.timestamp))}">${timeCell}</td>
      </tr>`;
  }
  logTableBody.innerHTML = html;
}

/* ========================================
   STUDENT HISTORY — points + awarding teacher per student
   ----------------------------------------
   Clicking a student card opens this modal with every logged award for
   that student and which teacher gave it. Uses a where-only query (no
   orderBy) so no composite index is needed; sorting happens client-side.
   ======================================== */
function openStudentHistory(studentId) {
  const student = allStudents.find((s) => s.id === studentId);
  if (!student) { showToast("Student not found.", "error"); return; }

  const key = (student.house || "").toLowerCase();
  const initials = (student.name || "?").split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  historyStudentAvatar.textContent = initials;
  historyStudentAvatar.className = `student-avatar student-avatar-${key}`;
  historyStudentName.textContent = student.name || "Student";
  historyStudentMeta.textContent =
    `${student.house || "—"}${student.className ? ` · ${student.className}` : ""} · Behaviour: ${student.merits || 0} · Uniform: ${student.uniformPoints || 0}`;
  historySummary.innerHTML = "";
  historyTeacherBreakdown.innerHTML = "";
  historyTableBody.innerHTML = `<tr><td colspan="4" class="student-table-empty">Loading history…</td></tr>`;
  studentHistoryModal.style.display = "flex";
  document.body.style.overflow = "hidden";

  if (unsubscribeHistory) { unsubscribeHistory(); unsubscribeHistory = null; }
  try {
    const q = query(collection(db, "meritLog"), where("studentId", "==", studentId), limit(500));
    unsubscribeHistory = onSnapshot(q, (snap) => {
      const entries = [];
      snap.forEach((d) => entries.push({ id: d.id, ...d.data() }));
      // Decorate-sort-undecorate: parsing each Timestamp once beats parsing it
      // on every comparison (O(n log n) Date allocations).
      const decorated = entries.map((e) => ({ e, t: logEntryDate(e)?.getTime() ?? -1 }));
      decorated.sort((a, b) => b.t - a.t);
      renderHistoryEntries(decorated.map((x) => x.e));
    }, (error) => {
      console.error("History listener error:", error);
      historyTableBody.innerHTML = `<tr><td colspan="4" class="student-table-empty">Failed to load history.</td></tr>`;
    });
  } catch (error) {
    console.error("Error opening student history:", error);
    historyTableBody.innerHTML = `<tr><td colspan="4" class="student-table-empty">Failed to load history.</td></tr>`;
  }
}

function renderHistoryEntries(entries) {
  if (!entries.length) {
    historySummary.innerHTML = `<span class="history-stat">No points recorded yet for this student.</span>`;
    historyTeacherBreakdown.innerHTML = "";
    historyTableBody.innerHTML = `<tr><td colspan="4" class="student-table-empty">No points recorded yet.</td></tr>`;
    return;
  }

  let behaviorTotal = 0, uniformTotal = 0;
  const perTeacher = {};
  for (const e of entries) {
    const chg = typeof e.change === "number" ? e.change : 0;
    if ((e.type || "honor") === "uniform") uniformTotal += chg;
    else behaviorTotal += chg;
    const teacher = (e.teacherEmail || "Unknown").toLowerCase();
    if (!perTeacher[teacher]) perTeacher[teacher] = { email: e.teacherEmail || "Unknown", total: 0, count: 0 };
    perTeacher[teacher].total += chg;
    perTeacher[teacher].count += 1;
  }

  historySummary.innerHTML = `
    <span class="history-stat"><strong>${entries.length}</strong> award${entries.length !== 1 ? "s" : ""}</span>
    <span class="history-stat history-stat-honor">🏅 <strong>${behaviorTotal >= 0 ? "+" : ""}${behaviorTotal}</strong> behaviour</span>
    <span class="history-stat history-stat-uniform">👔 <strong>${uniformTotal >= 0 ? "+" : ""}${uniformTotal}</strong> uniform</span>`;

  const ranked = Object.values(perTeacher).sort((a, b) => b.total - a.total);
  historyTeacherBreakdown.innerHTML =
    `<div class="history-breakdown-title">Given by</div>` +
    ranked.map((t) => `
      <div class="history-teacher-row">
        <span class="history-teacher-email">${escapeHtml(t.email)}</span>
        <span class="history-teacher-count">${t.count} award${t.count !== 1 ? "s" : ""}</span>
        <span class="log-change ${t.total > 0 ? "log-change-plus" : t.total < 0 ? "log-change-minus" : ""}">${t.total > 0 ? "+" : ""}${t.total}</span>
      </div>`).join("");

  historyTableBody.innerHTML = entries.map((e) => {
    const type = e.type === "uniform" ? "uniform" : "honor";
    const typeLabel = type === "uniform" ? "Uniform" : "Behaviour";
    const chg = typeof e.change === "number" ? e.change : null;
    const badge = chg === null ? "—"
      : `<span class="log-change ${chg > 0 ? "log-change-plus" : chg < 0 ? "log-change-minus" : ""}">${chg > 0 ? "+" : ""}${chg}</span>`;
    const credited = e.teacherEmail || "—";
    const awardedBy = e.awardedBy || "";
    const teacherCell = awardedBy && awardedBy.toLowerCase() !== String(credited || "").toLowerCase()
      ? `${escapeHtml(credited)}<div class="history-onbehalf">via ${escapeHtml(awardedBy)}</div>`
      : escapeHtml(credited);
    const d = logEntryDate(e);
    const timeCell = d
      ? `<div style="font-size:0.8rem;white-space:nowrap;">${escapeHtml(d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))}</div>
         <div style="font-size:0.7rem;color:var(--color-text-tertiary);white-space:nowrap;" title="${escapeAttr(formatFullTime(e.timestamp))}">${escapeHtml(formatTime(e.timestamp))}</div>`
      : `<span style="font-size:0.8rem;color:var(--color-text-tertiary);">—</span>`;
    return `<tr>
      <td style="white-space:nowrap;">${badge}</td>
      <td>${typeLabel}</td>
      <td style="font-size:0.8rem;">${teacherCell}</td>
      <td>${timeCell}</td>
    </tr>`;
  }).join("");
}

function closeStudentHistory() {
  if (studentHistoryModal) studentHistoryModal.style.display = "none";
  document.body.style.overflow = "";
  if (unsubscribeHistory) { unsubscribeHistory(); unsubscribeHistory = null; }
}

if (historyCloseBtn) {
  historyCloseBtn.addEventListener("click", closeStudentHistory);
}
if (studentHistoryModal) {
  studentHistoryModal.addEventListener("click", (e) => {
    if (e.target === studentHistoryModal) closeStudentHistory();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (studentHistoryModal && studentHistoryModal.style.display === "flex") closeStudentHistory();
  if (archiveDetailModal && archiveDetailModal.style.display === "flex") closeArchiveDetail();
  if (topStudentsModal && topStudentsModal.style.display === "flex") closeTopStudents();
  if (topTeachersModal && topTeachersModal.style.display === "flex") closeTopTeachers();
});

/* ========================================
   TOP RANKINGS — log view buttons
   ----------------------------------------
   🏆 Top Students: top 5 by behaviour points and top 5 by uniform
   points, computed from the already-loaded student list (all time).
   🧑‍🏫 Top Teachers: top 5 by behaviour points awarded and top 5 by
   uniform points awarded in a school week (Mon 00:00 → Fri 23:59 local).
   Defaults to last school week with ◀ ▶ navigation.
   Single-field range query — no composite index needed.
   ======================================== */
const TOP_MEDALS = ["🥇", "🥈", "🥉", "4.", "5."];

function topStudentRow(s, field, i) {
  const key = (s.house || "").toLowerCase();
  const initials = (s.name || "?").split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  return `
    <div class="top-row">
      <span class="top-rank">${TOP_MEDALS[i] || `${i + 1}.`}</span>
      <span class="student-avatar student-avatar-${key}" style="width:30px;height:30px;font-size:0.7rem;">${initials}</span>
      <span class="top-name">${escapeHtml(s.name || "—")}
        <span class="top-sub">${escapeHtml(s.house || "")}${s.className ? ` · ${escapeHtml(s.className)}` : ""}</span>
      </span>
      <span class="log-change ${i === 0 ? "log-change-plus" : ""}">${s[field] || 0}</span>
    </div>`;
}

function openTopStudents() {
  if (!allStudents.length) { showToast("No students to rank yet.", "error"); return; }
  topStudentScope = "week";
  studentWeekOffset = 0; // always start on last school week
  topStudentsModal.style.display = "flex";
  document.body.style.overflow = "hidden";
  renderTopStudents();
}

async function renderTopStudents() {
  const isWeek = topStudentScope === "week";
  topStudentsWeekScopeBtn.classList.toggle("active", isWeek);
  topStudentsAllScopeBtn.classList.toggle("active", !isWeek);
  topStudentsWeekNav.style.display = isWeek ? "flex" : "none";

  if (!isWeek) {
    topStudentsSubtitle.textContent = "Highest behaviour and uniform points (all time)";
    const byBehavior = [...allStudents].sort((a, b) => (b.merits || 0) - (a.merits || 0)).slice(0, 5);
    const byUniform = [...allStudents].sort((a, b) => (b.uniformPoints || 0) - (a.uniformPoints || 0)).slice(0, 5);
    topBehaviorList.innerHTML = byBehavior.map((s, i) => topStudentRow(s, "merits", i)).join("");
    topUniformList.innerHTML = byUniform.map((s, i) => topStudentRow(s, "uniformPoints", i)).join("");
    return;
  }

  const { start, end } = schoolWeekRange(studentWeekOffset);
  topStudentsWeekLabel.textContent = formatWeekLabel(start, end);
  topStudentsSubtitle.textContent = `Points received · ${formatWeekLabel(start, end)}`;
  topStudentsNextBtn.disabled = studentWeekOffset >= 1;
  topBehaviorList.innerHTML = `<div class="student-table-empty">Loading…</div>`;
  topUniformList.innerHTML = `<div class="student-table-empty">Loading…</div>`;
  try {
    const q = query(
      collection(db, "meritLog"),
      where("timestamp", ">=", Timestamp.fromDate(start)),
      where("timestamp", "<=", Timestamp.fromDate(end)),
      limit(1000)
    );
    const snap = await getDocs(q);
    // One lookup map instead of an allStudents.find() scan per log doc.
    const studentsById = new Map(allStudents.map((s) => [s.id, s]));
    const perStudent = {};
    snap.forEach((d) => {
      const e = d.data() || {};
      const chg = typeof e.change === "number" ? e.change : 0;
      if (chg <= 0) return; // only points actually received, not removals
      const sid = e.studentId || e.studentName || "unknown";
      if (!perStudent[sid]) {
        const s = studentsById.get(e.studentId);
        perStudent[sid] = {
          name: s?.name || e.studentName || "Unknown",
          house: s?.house || e.house || "",
          className: s?.className || e.studentClass || "",
          merits: 0,
          uniformPoints: 0
        };
      }
      if ((e.type || "honor") === "uniform") perStudent[sid].uniformPoints += chg;
      else perStudent[sid].merits += chg;
    });
    const ranked = Object.values(perStudent);
    const byBehavior = [...ranked].sort((a, b) => b.merits - a.merits).slice(0, 5);
    const byUniform = [...ranked].sort((a, b) => b.uniformPoints - a.uniformPoints).slice(0, 5);
    topBehaviorList.innerHTML = byBehavior.length
      ? byBehavior.map((s, i) => topStudentRow(s, "merits", i)).join("")
      : `<div class="student-table-empty">No behaviour points awarded that week.</div>`;
    topUniformList.innerHTML = byUniform.length
      ? byUniform.map((s, i) => topStudentRow(s, "uniformPoints", i)).join("")
      : `<div class="student-table-empty">No uniform points awarded that week.</div>`;
  } catch (error) {
    console.error("Error loading top students:", error);
    topBehaviorList.innerHTML = `<div class="student-table-empty">Failed to load rankings.</div>`;
    topUniformList.innerHTML = "";
  }
}

function closeTopStudents() {
  if (topStudentsModal) topStudentsModal.style.display = "none";
  document.body.style.overflow = "";
}

// Monday 00:00 (local) of the school week for the given offset:
// 0 = last Mon–Fri, 1 = current Mon–Fri, -1 = the week before last, …
function schoolWeekRange(offset) {
  const now = new Date();
  const daysSinceMon = (now.getDay() + 6) % 7;
  const thisMon = startOfDay(now) - daysSinceMon * 86400000;
  const mon = thisMon + (offset - 1) * 7 * 86400000;
  return { start: new Date(mon), end: new Date(mon + 5 * 86400000 - 1) };
}

function formatWeekLabel(start, end) {
  const opts = { month: "short", day: "numeric" };
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const left = start.toLocaleDateString(undefined, sameMonth ? opts : { ...opts, year: "numeric" });
  const right = end.toLocaleDateString(undefined, { ...opts, year: "numeric" });
  return `Mon ${left} – Fri ${right}`;
}

async function openTopTeachers() {
  topTeacherScope = "week";
  teacherWeekOffset = 0; // always start on last school week
  topTeachersModal.style.display = "flex";
  document.body.style.overflow = "hidden";
  await renderTopTeachers();
}

function closeTopTeachers() {
  if (topTeachersModal) topTeachersModal.style.display = "none";
  document.body.style.overflow = "";
}

async function renderTopTeachers() {
  const isWeek = topTeacherScope === "week";
  if (topTeachersWeekScopeBtn) topTeachersWeekScopeBtn.classList.toggle("active", isWeek);
  if (topTeachersAllScopeBtn) topTeachersAllScopeBtn.classList.toggle("active", !isWeek);
  if (topTeachersWeekNav) topTeachersWeekNav.style.display = isWeek ? "flex" : "none";

  const showLoading = () => {
    topTeachersBehaviorList.innerHTML = `<div class="student-table-empty">Loading…</div>`;
    topTeachersUniformList.innerHTML = `<div class="student-table-empty">Loading…</div>`;
  };
  const showError = () => {
    topTeachersBehaviorList.innerHTML = `<div class="student-table-empty">Failed to load rankings.</div>`;
    topTeachersUniformList.innerHTML = `<div class="student-table-empty">Failed to load rankings.</div>`;
  };

  if (!isWeek) {
    topTeachersSubtitle.textContent = "Most behaviour and uniform points awarded (all time)";
    topTeachersWeekLabel.textContent = "";
    showLoading();
    try {
      // No filters — capped at the latest 2000 awards to bound read cost.
      const snap = await getDocs(query(collection(db, "meritLog"), limit(2000)));
      aggregateAndRenderTeachers(snap, snap.size >= 2000 ? " · latest 2000 awards" : "");
    } catch (error) {
      console.error("Error loading top teachers:", error);
      showError();
    }
    return;
  }

  const { start, end } = schoolWeekRange(teacherWeekOffset);
  topTeachersWeekLabel.textContent = formatWeekLabel(start, end);
  topTeachersSubtitle.textContent = `Points awarded · ${formatWeekLabel(start, end)}`;
  topTeachersNextBtn.disabled = teacherWeekOffset >= 1;
  showLoading();
  try {
    const q = query(
      collection(db, "meritLog"),
      where("timestamp", ">=", Timestamp.fromDate(start)),
      where("timestamp", "<=", Timestamp.fromDate(end)),
      limit(1000)
    );
    const snap = await getDocs(q);
    aggregateAndRenderTeachers(
      snap,
      "",
      "No behaviour points awarded that week.",
      "No uniform points awarded that week."
    );
  } catch (error) {
    console.error("Error loading top teachers:", error);
    showError();
  }
}

function topTeacherRow(t, field, i) {
  return `
    <div class="top-row">
      <span class="top-rank">${TOP_MEDALS[i] || `${i + 1}.`}</span>
      <span class="top-name">${escapeHtml(t.email)}</span>
      <span class="log-change ${i === 0 ? "log-change-plus" : ""}">+${t[field] || 0}</span>
    </div>`;
}

function aggregateAndRenderTeachers(
  snap,
  rangeNote = "",
  emptyBehaviorMsg = "No behaviour points have been awarded yet.",
  emptyUniformMsg = "No uniform points have been awarded yet."
) {
  const perTeacher = {};
  snap.forEach((d) => {
    const e = d.data() || {};
    const chg = typeof e.change === "number" ? e.change : 0;
    if (chg <= 0) return; // only points actually awarded, not removals
    const key = String(e.teacherEmail || "Unknown").toLowerCase();
    if (!perTeacher[key]) {
      perTeacher[key] = { email: e.teacherEmail || "Unknown", behavior: 0, uniform: 0 };
    }
    const t = perTeacher[key];
    if ((e.type || "honor") === "uniform") t.uniform += chg;
    else t.behavior += chg;
  });
  const all = Object.values(perTeacher);
  const byBehavior = [...all].sort((a, b) => b.behavior - a.behavior).slice(0, 5);
  const byUniform = [...all].sort((a, b) => b.uniform - a.uniform).slice(0, 5);
  if (rangeNote) topTeachersSubtitle.textContent += rangeNote;
  topTeachersBehaviorList.innerHTML = byBehavior.length
    ? byBehavior.map((t, i) => topTeacherRow(t, "behavior", i)).join("")
    : `<div class="student-table-empty">${emptyBehaviorMsg}</div>`;
  topTeachersUniformList.innerHTML = byUniform.length
    ? byUniform.map((t, i) => topTeacherRow(t, "uniform", i)).join("")
    : `<div class="student-table-empty">${emptyUniformMsg}</div>`;
}

if (topStudentsBtn) topStudentsBtn.addEventListener("click", openTopStudents);
if (topTeachersBtn) topTeachersBtn.addEventListener("click", openTopTeachers);
if (topStudentsCloseBtn) topStudentsCloseBtn.addEventListener("click", closeTopStudents);
if (topTeachersCloseBtn) topTeachersCloseBtn.addEventListener("click", closeTopTeachers);
if (topStudentsWeekScopeBtn) {
  topStudentsWeekScopeBtn.addEventListener("click", () => {
    topStudentScope = "week";
    renderTopStudents();
  });
}
if (topStudentsAllScopeBtn) {
  topStudentsAllScopeBtn.addEventListener("click", () => {
    topStudentScope = "all";
    renderTopStudents();
  });
}
if (topStudentsPrevBtn) {
  topStudentsPrevBtn.addEventListener("click", () => {
    studentWeekOffset -= 1;
    renderTopStudents();
  });
}
if (topStudentsNextBtn) {
  topStudentsNextBtn.addEventListener("click", () => {
    if (studentWeekOffset < 1) {
      studentWeekOffset += 1;
      renderTopStudents();
    }
  });
}
if (topStudentsModal) {
  topStudentsModal.addEventListener("click", (e) => {
    if (e.target === topStudentsModal) closeTopStudents();
  });
}
if (topTeachersModal) {
  topTeachersModal.addEventListener("click", (e) => {
    if (e.target === topTeachersModal) closeTopTeachers();
  });
}
if (topTeachersPrevBtn) {
  topTeachersPrevBtn.addEventListener("click", () => {
    teacherWeekOffset -= 1;
    renderTopTeachers();
  });
}
if (topTeachersNextBtn) {
  topTeachersNextBtn.addEventListener("click", () => {
    if (teacherWeekOffset < 1) {
      teacherWeekOffset += 1;
      renderTopTeachers();
    }
  });
}
if (topTeachersWeekScopeBtn) {
  topTeachersWeekScopeBtn.addEventListener("click", () => {
    topTeacherScope = "week";
    renderTopTeachers();
  });
}
if (topTeachersAllScopeBtn) {
  topTeachersAllScopeBtn.addEventListener("click", () => {
    topTeacherScope = "all";
    renderTopTeachers();
  });
}

/* ========================================
   TEACHERS — BULK ADD
   ======================================== */
addTeachersBulkBtn.addEventListener("click", async () => {
  if (!isAdmin()) { showToast("Only the admin can add teachers.", "error"); return; }
  const raw = teacherBulkInput.value;

  const emails = raw
    .split("\n")
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.includes("@"));

  if (emails.length === 0) { showToast("Please enter at least one valid email.", "error"); return; }

  const bulkRole = teacherBulkRoleSelect.value || "";

  addTeachersBulkBtn.disabled = true;
  addTeachersBulkBtn.textContent = `Adding ${emails.length}...`;

  try {
    const batch = writeBatch(db);
    for (const email of emails) {
      const ref = doc(db, "allowedUsers", email);
      // merge: re-adding an existing teacher keeps their homeroom class.
      batch.set(ref, bulkRole ? { email, role: bulkRole } : { email }, { merge: true });
    }
    await batch.commit();
    showToast(`Added ${emails.length} teacher${emails.length > 1 ? "s" : ""}! ✅`, "success");
    teacherBulkInput.value = "";
  } catch (error) {
    console.error("Error adding teachers:", error);
    showToast("Failed to add teachers. Please try again.", "error");
  }

  addTeachersBulkBtn.disabled = false;
  addTeachersBulkBtn.textContent = "Add Teachers";
});

/* ========================================
   MANAGE — ADD SINGLE STUDENT
   ======================================== */
addStudentSingleBtn.addEventListener("click", async () => {
  if (!isAdmin()) { showToast("Only the admin can add students.", "error"); return; }
  const name = studentNameInput.value.trim();
  const house = studentHouseSelect.value;
  const className = studentClassInput.value.trim();
  const email = studentEmailInput.value.trim().toLowerCase();

  if (!name) { showToast("Please enter the student's name.", "error"); return; }
  if (!house) { showToast("Please select a house.", "error"); return; }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    showToast("Please enter a valid email address.", "error");
    return;
  }

  addStudentSingleBtn.disabled = true;
  addStudentSingleBtn.textContent = "Adding...";

  try {
    await addDoc(collection(db, "students"), {
      name,
      house,
      className,
      email,
      merits: 0,
      uniformPoints: 0,
      createdAt: serverTimestamp()
    });
    showToast(`Added ${name} to ${house} house! ✅`, "success");
    studentNameInput.value = "";
    studentHouseSelect.value = "";
    studentClassInput.value = "";
    studentEmailInput.value = "";
  } catch (error) {
    console.error("Error adding student:", error);
    showToast("Failed to add student. Please try again.", "error");
  }

  addStudentSingleBtn.disabled = false;
  addStudentSingleBtn.textContent = "Add Student";
});

/* ========================================
   MANAGE — EXCEL / CSV IMPORT
   ======================================== */

// Click upload area to trigger file input
uploadArea.addEventListener("click", () => fileInput.click());

// Prevent the browser's default drop action (downloading/opening the file)
// ANYWHERE in the window, and route the dropped file into the import parser.
window.addEventListener("dragover", (e) => {
  e.preventDefault();
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("drag-over");
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
});

// Visual feedback when hovering over the upload area.
uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("drag-over");
});
uploadArea.addEventListener("dragleave", () => {
  uploadArea.classList.remove("drag-over");
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    handleFile(fileInput.files[0]);
    fileInput.value = "";
  }
});

// SheetJS (~950KB) is only needed for the admin Excel import/template, so it
// loads on demand instead of blocking first paint. Cached after first use.
let xlsxReady = null;
function loadXLSX() {
  if (!xlsxReady) {
    xlsxReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js";
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => {
        xlsxReady = null; // allow a retry
        reject(new Error("Spreadsheet library failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return xlsxReady;
}

async function handleFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["xlsx", "xls", "csv"].includes(ext)) {
    showToast("Unsupported file format. Please use .xlsx, .xls, or .csv", "error");
    return;
  }

  try {
    const XLSX = await loadXLSX();
    const data = new Uint8Array(await file.arrayBuffer());
    const workbook = XLSX.read(data, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (json.length === 0) {
      showToast("No data found in file.", "error");
      return;
    }

    // Normalise column headers (case-insensitive)
    const headers = Object.keys(json[0]);
    const nameKey = headers.find((h) => h.toLowerCase().trim() === "name");
    const houseKey = headers.find((h) => h.toLowerCase().trim() === "house");
    const classKey = headers.find((h) => h.toLowerCase().trim() === "class");
    const emailKey = headers.find((h) => h.toLowerCase().trim() === "email");

    if (!nameKey || !houseKey) {
      showToast("File must have 'Name' and 'House' columns.", "error");
      return;
    }

    // Validate and normalise house names
    const validHouses = HOUSES.map((h) => h.toLowerCase());
    parsedImportData = [];
    const errors = [];

    json.forEach((row, i) => {
      const rawName = String(row[nameKey]).trim();
      const rawHouse = String(row[houseKey]).trim();
      const rawClass = classKey ? String(row[classKey]).trim() : "";
      const rawEmail = emailKey ? String(row[emailKey]).trim().toLowerCase() : "";
      const normalisedHouse = HOUSES.find(
        (h) => h.toLowerCase() === rawHouse.toLowerCase()
      );

      if (!rawName) {
        errors.push(`Row ${i + 2}: missing name`);
        return;
      }
      if (!normalisedHouse) {
        errors.push(`Row ${i + 2}: "${rawHouse}" is not a valid house (use: ${HOUSES.join(", ")})`);
        return;
      }
      if (rawEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) {
        errors.push(`Row ${i + 2}: "${rawEmail}" is not a valid email`);
        return;
      }
      parsedImportData.push({ name: rawName, house: normalisedHouse, className: rawClass, email: rawEmail });
    });

    if (parsedImportData.length === 0) {
      showToast("No valid rows found to import.", "error");
      return;
    }

    // Show preview
    previewBody.innerHTML = parsedImportData
      .map((s, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.house)}</td><td>${s.className ? escapeHtml(s.className) : "—"}</td><td>${s.email ? escapeHtml(s.email) : "—"}</td></tr>`)
      .join("");
    previewCount.textContent = `${parsedImportData.length} student${parsedImportData.length > 1 ? "s" : ""}`;
    uploadPreview.classList.add("visible");

    if (errors.length > 0) {
      showToast(`${parsedImportData.length} valid rows. ${errors.length} skipped (check console).`, "info");
      console.warn("Import errors:", errors);
    }

  } catch (error) {
      console.error("Error parsing file:", error);
      showToast("Failed to parse file. Make sure it's a valid Excel/CSV file.", "error");
    }
}

/* Import button */
importBtn.addEventListener("click", async () => {
  if (!isAdmin()) { showToast("Only the admin can import students.", "error"); return; }
  if (parsedImportData.length === 0) return;

  importBtn.disabled = true;
  importBtn.textContent = `Importing ${parsedImportData.length}...`;

  try {
    const batch = writeBatch(db);
    for (const student of parsedImportData) {
      const ref = doc(collection(db, "students"));
      batch.set(ref, {
        name: student.name,
        house: student.house,
        className: student.className || "",
        email: student.email || "",
        merits: 0,
        uniformPoints: 0,
        createdAt: serverTimestamp()
      });
    }
    await batch.commit();

    showToast(`Imported ${parsedImportData.length} students successfully! ✅`, "success");
    uploadPreview.classList.remove("visible");
    parsedImportData = [];
  } catch (error) {
    console.error("Error importing students:", error);
    showToast("Failed to import students. Please try again.", "error");
  }

  importBtn.disabled = false;
  importBtn.textContent = "Import All";
});

/* Cancel preview */
cancelPreviewBtn.addEventListener("click", () => {
  uploadPreview.classList.remove("visible");
  parsedImportData = [];
});

/* ========================================
   DOWNLOAD EXCEL TEMPLATE
   ======================================== */
downloadTemplateBtn.addEventListener("click", async () => {
  let XLSX;
  try {
    XLSX = await loadXLSX();
  } catch {
    showToast("Couldn't load the spreadsheet library. Check your connection and try again.", "error");
    return;
  }
  const rows = [
    ["Name", "House", "Class", "Email"],
    ["Alice Chen", "Green", "7A", "alice.chen@school.edu"],
    ["Benjamin Park", "Blue", "7B", "benjamin.park@school.edu"]
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");
  XLSX.writeFile(wb, "sisb-behaviour-point-students-template.xlsx");
  showToast("Template downloaded! Fill it in and drop it below.", "info");
});

/* ========================================
   MANAGE — STUDENT LIST & DELETE
   ======================================== */
function renderManageStudentList() {
  if (allStudents.length === 0) {
    manageStudentBody.innerHTML = `<tr><td colspan="7" class="student-table-empty">No students yet. Add some above!</td></tr>`;
    manageStudentCount.textContent = "0";
    return;
  }

  manageStudentCount.textContent = allStudents.length;
  manageStudentBody.innerHTML = allStudents
    .map(
      (s) => `
      <tr>
        <td>
          <span class="house-dot house-dot-${s.house.toLowerCase()}"></span>
          ${escapeHtml(s.name)}
        </td>
        <td>
          <select class="form-select house-select" data-student-id="${s.id}" data-student-name="${escapeAttr(s.name)}" title="Change house for ${escapeAttr(s.name)}">
            ${Object.keys(HOUSE_EMOJIS)
              .map(
                (h) =>
                  `<option value="${h}" class="opt-${h.toLowerCase()}" ${h === s.house ? "selected" : ""}>${HOUSE_EMOJIS[h]} ${h}</option>`
              )
              .join("")}
          </select>
        </td>
        <td>${escapeHtml(s.className || "—")}</td>
        <td>${s.merits || 0}</td>
        <td>${s.uniformPoints || 0}</td>
        <td>
          <span class="student-email-cell">${escapeHtml(s.email || "—")}</span>
          <button class="btn-icon edit-email-btn" data-student-id="${s.id}" data-student-name="${escapeAttr(s.name)}" data-email="${escapeAttr(s.email || "")}" title="Set email for ${escapeAttr(s.name)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </td>
        <td>
          <button class="btn-icon delete-btn" data-student-id="${s.id}" data-student-name="${escapeAttr(s.name)}" title="Delete ${escapeAttr(s.name)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </td>
      </tr>`
    )
    .join("");

  // (row handlers are delegated on manageStudentBody — see below)
}

// One delegated listener set for the manage table. Rows are rebuilt with
// innerHTML on every snapshot, so per-row handlers meant ~3N attachments per
// data change. The handlers stay async so their awaits work as before.
manageStudentBody.addEventListener("change", async (e) => {
  // Admins may reassign a student's house.
  const sel = e.target.closest(".house-select");
  if (!sel) return;
  if (!isAdmin()) { showToast("Only the admin can change a student's house.", "error"); renderManageStudentList(); return; }
  const id = sel.dataset.studentId;
  const name = sel.dataset.studentName;
  const student = allStudents.find((s) => s.id === id);
  const previous = student ? student.house : sel.options[0]?.value;
  const house = sel.value;
  if (!house || house === previous) return;
  try {
    await updateDoc(doc(db, "students", id), { house });
    showToast(`${name} moved to ${HOUSE_EMOJIS[house]} ${house}. ✅`, "success");
  } catch (error) {
    console.error("Error setting house:", error);
    showToast("Failed to change house. Please try again.", "error");
    sel.value = previous || "";
  }
});

manageStudentBody.addEventListener("click", async (e) => {
  const editBtn = e.target.closest(".edit-email-btn");
  if (editBtn) {
    if (!isAdmin()) { showToast("Only the admin can edit student emails.", "error"); return; }
    const id = editBtn.dataset.studentId;
    const name = editBtn.dataset.studentName;
    const current = editBtn.dataset.email || "";
    const email = prompt(`Email for ${name}:`, current);
    if (email === null) return;
    const trimmed = email.trim().toLowerCase();
    if (trimmed && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      showToast("Please enter a valid email address.", "error");
      return;
    }
    try {
      await updateDoc(doc(db, "students", id), { email: trimmed });
      showToast(trimmed ? `Email set for ${name}. ✅` : `Email cleared for ${name}.`, "success");
    } catch (error) {
      console.error("Error setting email:", error);
      showToast("Failed to set email. Please try again.", "error");
    }
    return;
  }

  const deleteBtn = e.target.closest(".delete-btn");
  if (deleteBtn) {
    if (!isAdmin()) { showToast("Only the admin can delete students.", "error"); return; }
    const id = deleteBtn.dataset.studentId;
    const name = deleteBtn.dataset.studentName;
    if (confirm(`Delete ${name}? This cannot be undone.`)) {
      try {
        await deleteDoc(doc(db, "students", id));
        showToast(`Deleted ${name}.`, "info");
      } catch (error) {
        console.error("Error deleting student:", error);
        showToast("Failed to delete student. Please try again.", "error");
      }
    }
  }
});

/* ========================================
   ARCHIVE — snapshot the current status of all students + teachers
   ----------------------------------------
   Admin-only. "Archive current status" reads BOTH collections fresh at
   click time (never the live listener state, which may be stale or not
   subscribed at all), stores one document in the `archives` collection and
   downloads the same snapshot as .xlsx. Past archives are listed in their
   own view, previewed in a detail modal and can be deleted. There is
   deliberately no restore.
   ======================================== */

// Listener + render for the archive table.
function setupArchiveListener() {
  if (unsubscribeArchives) unsubscribeArchives();

  const q = query(
    collection(db, "archives"),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  unsubscribeArchives = onSnapshot(
    q,
    (snapshot) => {
      allArchives = [];
      snapshot.forEach((d) => allArchives.push({ id: d.id, ...d.data() }));
      renderArchiveList();
    },
    (error) => {
      console.error("Archives listener error:", error);
      showToast("Failed to load archives.", "error");
    }
  );
}

function renderArchiveList() {
  if (!archiveTableBody) return;
  if (archiveCount) archiveCount.textContent = allArchives.length;

  if (allArchives.length === 0) {
    archiveTableBody.innerHTML = `<tr><td colspan="6" class="student-table-empty">No archives yet. Click "Archive current status".</td></tr>`;
    return;
  }

  // Rows are rebuilt with innerHTML on every snapshot, so the click handlers
  // are delegated on archiveTableBody below.
  archiveTableBody.innerHTML = allArchives
    .map((a) => `
      <tr>
        <td style="white-space:nowrap;">${escapeHtml(formatFullTime(a.createdAt))}</td>
        <td>${escapeHtml(a.createdBy || "—")}</td>
        <td>${escapeHtml(a.label || "—")}</td>
        <td>${escapeHtml(a.studentCount || 0)}</td>
        <td>${escapeHtml(a.teacherCount || 0)}</td>
        <td class="archive-row-actions">
          <button class="btn btn-small btn-outline archive-view-btn" data-archive-id="${escapeAttr(a.id)}">View</button>
          <button class="btn btn-small btn-outline archive-download-btn" data-archive-id="${escapeAttr(a.id)}">⬇️ Excel</button>
          <button class="btn-icon archive-delete-btn" data-archive-id="${escapeAttr(a.id)}" title="Delete archive">🗑</button>
        </td>
      </tr>`)
    .join("");
}

// Snapshot the live collections and download the same payload. Reads are done
// here (not from allStudents / the teacher listener) so a stale client cache
// can never produce a stale archive.
async function archiveNow() {
  if (!isAdmin()) { showToast("Only the admin can archive.", "error"); return; }

  // Capture innerHTML, not textContent: assigning textContent would delete the
  // button's inline <svg> icon and it would never come back.
  const originalHtml = archiveNowBtn.innerHTML;
  archiveNowBtn.disabled = true;
  archiveNowBtn.textContent = "Archiving…";

  let payload = null;
  try {
    const [studentsSnap, teachersSnap] = await Promise.all([
      getDocs(collection(db, "students")),
      getDocs(collection(db, "allowedUsers"))
    ]);

    // Normalise defensively: Firestore rejects `undefined`, so every missing
    // field becomes "" or 0.
    const students = [];
    studentsSnap.forEach((d) => {
      const s = d.data() || {};
      students.push({
        id: d.id,
        name: s.name || "",
        house: s.house || "",
        className: s.className || "",
        email: s.email || "",
        merits: typeof s.merits === "number" ? s.merits : 0,
        uniformPoints: typeof s.uniformPoints === "number" ? s.uniformPoints : 0
      });
    });

    const teachers = [];
    teachersSnap.forEach((d) => {
      const t = d.data() || {};
      // allowedUsers doc ids are the lowercased email, so fall back to it
      // when the stored `email` field is missing.
      teachers.push({
        email: t.email || d.id || "",
        role: t.role || "",
        homeroom: t.homeroom || ""
      });
    });

    payload = {
      createdAt: serverTimestamp(),
      createdBy: (currentUser?.email || "").toLowerCase(),
      label: "Archive " + new Date().toLocaleString(),
      studentCount: students.length,
      teacherCount: teachers.length,
      students,
      teachers
    };

    // Firestore caps one document at 1 MiB. Measure UTF-8 bytes rather than JS
    // string length — Thai names and emoji cost 3-4 bytes per character, so a
    // char count can understate the real document size. Keep a safety margin:
    // when the snapshot is too large, skip the save but still hand over the
    // Excel file.
    const payloadJson = JSON.stringify({ students, teachers });
    const payloadSize = new TextEncoder().encode(payloadJson).length;
    if (payloadSize > 900000) {
      showToast("Snapshot is too large to store in Firestore — downloading the Excel file only.", "error");
    } else {
      await addDoc(collection(db, "archives"), payload);
      showToast(`Archived ${students.length} students and ${teachers.length} teachers. ✅`, "success");
    }
  } catch (error) {
    console.error("Error creating archive:", error);
    showToast("Failed to create the archive. Please try again.", "error");
  } finally {
    archiveNowBtn.disabled = false;
    archiveNowBtn.innerHTML = originalHtml;
  }

  // Same click saves and downloads, even when the save was skipped or failed.
  if (payload) await downloadArchive(payload);
}

// Build a two-sheet workbook: every snapshot field, full list (no 500 cap).
async function downloadArchive(archive) {
  if (!archive) return;

  let XLSX;
  try {
    XLSX = await loadXLSX();
  } catch {
    showToast("Couldn't load the spreadsheet library. Check your connection and try again.", "error");
    return;
  }

  const students = Array.isArray(archive.students) ? archive.students : [];
  const teachers = Array.isArray(archive.teachers) ? archive.teachers : [];

  const studentRows = [
    ["Name", "House", "Class", "Email", "Behaviour Points", "Uniform Points"],
    ...students.map((s) => [
      s.name || "",
      s.house || "",
      s.className || "",
      s.email || "",
      typeof s.merits === "number" ? s.merits : 0,
      typeof s.uniformPoints === "number" ? s.uniformPoints : 0
    ])
  ];
  const wsStudents = XLSX.utils.aoa_to_sheet(studentRows);
  wsStudents["!cols"] = [{ wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 30 }, { wch: 16 }, { wch: 14 }];

  const teacherRows = [
    ["Email", "Role", "Homeroom"],
    ...teachers.map((t) => [t.email || "", roleLabel(t.role), t.homeroom || ""])
  ];
  const wsTeachers = XLSX.utils.aoa_to_sheet(teacherRows);
  wsTeachers["!cols"] = [{ wch: 30 }, { wch: 14 }, { wch: 12 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsStudents, "Students");
  XLSX.utils.book_append_sheet(wb, wsTeachers, "Teachers");

  // Stored archives carry a Firestore Timestamp; a just-created payload still
  // holds the serverTimestamp() sentinel, so fall back to "now" when
  // createdAt can't be read as a date.
  let when = new Date();
  const raw = archive.createdAt;
  if (raw && typeof raw.toDate === "function") {
    when = raw.toDate();
  } else if (raw) {
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) when = parsed;
  }
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}`;

  XLSX.writeFile(wb, `sisb-archive-${stamp}.xlsx`);
}

// Detail modal — preview an archive (capped) and remember it for re-download.
const ARCHIVE_PREVIEW_LIMIT = 500;

function openArchiveDetail(id) {
  if (!isAdmin()) { showToast("Only the admin can view archives.", "error"); return; }
  const archive = allArchives.find((a) => a.id === id);
  if (!archive) { showToast("Archive not found.", "error"); return; }

  const students = Array.isArray(archive.students) ? archive.students : [];
  const teachers = Array.isArray(archive.teachers) ? archive.teachers : [];

  archiveDetailTitle.textContent = archive.label || "Archive";
  archiveDetailMeta.textContent = `${formatFullTime(archive.createdAt)} · ${archive.createdBy || "—"}`;
  archiveDetailSummary.innerHTML =
    `<span class="history-stat"><strong>${students.length}</strong> student${students.length !== 1 ? "s" : ""}</span>` +
    `<span class="history-stat"><strong>${teachers.length}</strong> teacher${teachers.length !== 1 ? "s" : ""}</span>`;

  // A big roster would make the modal unusable — the Excel file has it all.
  const shownStudents = students.slice(0, ARCHIVE_PREVIEW_LIMIT);
  archiveDetailStudentsBody.innerHTML = shownStudents.length === 0
    ? `<tr><td colspan="6" class="student-table-empty">No students in this archive.</td></tr>`
    : shownStudents.map((s) => {
        const house = HOUSES.includes(s.house) ? s.house : "";
        const houseCell = s.house
          ? `${house ? `<span class="house-dot house-dot-${house.toLowerCase()}"></span>` : ""}${escapeHtml(s.house)}`
          : "—";
        return `<tr>
          <td>${escapeHtml(s.name || "—")}</td>
          <td>${houseCell}</td>
          <td>${s.className ? escapeHtml(s.className) : "—"}</td>
          <td>${typeof s.merits === "number" ? s.merits : 0}</td>
          <td>${typeof s.uniformPoints === "number" ? s.uniformPoints : 0}</td>
          <td><span class="student-email-cell">${escapeHtml(s.email || "—")}</span></td>
        </tr>`;
      }).join("");
  archiveDetailStudentsNote.textContent = students.length > ARCHIVE_PREVIEW_LIMIT
    ? `Showing first ${ARCHIVE_PREVIEW_LIMIT} of ${students.length} — download the Excel for the full list.`
    : "";

  const shownTeachers = teachers.slice(0, ARCHIVE_PREVIEW_LIMIT);
  archiveDetailTeachersBody.innerHTML = shownTeachers.length === 0
    ? `<tr><td colspan="3" class="student-table-empty">No teachers in this archive.</td></tr>`
    : shownTeachers.map((t) => `<tr>
        <td>${escapeHtml(t.email || "—")}</td>
        <td>${escapeHtml(roleLabel(t.role))}</td>
        <td>${t.homeroom ? escapeHtml(t.homeroom) : "—"}</td>
      </tr>`).join("");
  archiveDetailTeachersNote.textContent = teachers.length > ARCHIVE_PREVIEW_LIMIT
    ? `Showing first ${ARCHIVE_PREVIEW_LIMIT} of ${teachers.length} — download the Excel for the full list.`
    : "";

  openArchiveId = id;
  archiveDetailModal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closeArchiveDetail() {
  if (archiveDetailModal) archiveDetailModal.style.display = "none";
  document.body.style.overflow = "";
  openArchiveId = null;
}

async function deleteArchive(id) {
  if (!isAdmin()) { showToast("Only the admin can delete archives.", "error"); return; }
  const archive = allArchives.find((a) => a.id === id);
  const when = archive ? formatFullTime(archive.createdAt) : "this archive";
  if (!confirm(`Delete the archive from ${when}? This cannot be undone.`)) return;

  try {
    await deleteDoc(doc(db, "archives", id));
    showToast("Archive deleted.", "info");
  } catch (error) {
    console.error("Error deleting archive:", error);
    showToast("Failed to delete the archive. Please try again.", "error");
  }
}

/* Archive view toggling */
if (archiveToggleBtn) {
  archiveToggleBtn.addEventListener("click", () => {
    if (!isAdmin()) { showToast("Only the admin can view archives.", "error"); return; }
    dashboardView.style.display = "none";
    manageView.style.display = "none";
    teachersView.style.display = "none";
    logView.style.display = "none";
    scoreboardView.style.display = "none";
    // Leaving these views stops their listeners, exactly like the other
    // view-toggle handlers do.
    if (unsubscribeTeachers) { unsubscribeTeachers(); unsubscribeTeachers = null; }
    if (unsubscribeLog) { unsubscribeLog(); unsubscribeLog = null; }
    archiveView.style.display = "block";
    setupArchiveListener();
  });
}

if (backFromArchiveBtn) {
  backFromArchiveBtn.addEventListener("click", () => {
    archiveView.style.display = "none";
    dashboardView.style.display = "block";
    if (unsubscribeArchives) { unsubscribeArchives(); unsubscribeArchives = null; }
  });
}

if (archiveNowBtn) archiveNowBtn.addEventListener("click", archiveNow);

// One delegated listener for the archive table (rows are rebuilt with
// innerHTML on every snapshot).
if (archiveTableBody) {
  archiveTableBody.addEventListener("click", async (e) => {
    const viewBtn = e.target.closest(".archive-view-btn");
    if (viewBtn) { openArchiveDetail(viewBtn.dataset.archiveId); return; }

    const downloadBtn = e.target.closest(".archive-download-btn");
    if (downloadBtn) {
      if (!isAdmin()) { showToast("Only the admin can download archives.", "error"); return; }
      const archive = allArchives.find((a) => a.id === downloadBtn.dataset.archiveId);
      if (!archive) { showToast("Archive not found.", "error"); return; }
      await downloadArchive(archive);
      return;
    }

    const deleteBtn = e.target.closest(".archive-delete-btn");
    if (deleteBtn) { deleteArchive(deleteBtn.dataset.archiveId); return; }
  });
}

/* Archive detail modal wiring */
if (archiveDetailCloseBtn) archiveDetailCloseBtn.addEventListener("click", closeArchiveDetail);

if (archiveDetailDownloadBtn) {
  archiveDetailDownloadBtn.addEventListener("click", async () => {
    if (!isAdmin()) { showToast("Only the admin can download archives.", "error"); return; }
    if (!openArchiveId) return;
    const archive = allArchives.find((a) => a.id === openArchiveId);
    if (!archive) { showToast("Archive not found.", "error"); return; }
    await downloadArchive(archive);
  });
}

// Match the other modals: clicking the overlay backdrop closes the dialog.
if (archiveDetailModal) {
  archiveDetailModal.addEventListener("click", (e) => {
    if (e.target === archiveDetailModal) closeArchiveDetail();
  });
}
