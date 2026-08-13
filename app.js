/* ========================================
   SISB Honor — Merit System
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
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  increment,
  query,
  where,
  onSnapshot,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

/* ========================================
   HOUSES
   ======================================== */
const HOUSES = ["Green", "Blue", "Yellow", "Red", "Orange"];

/* ========================================
   ADMIN — stored in Firestore config/admin document
   ======================================== */
let adminEmails = [];

async function fetchAdminConfig() {
  try {
    const adminRef = doc(db, "config", "admin");
    const adminSnap = await getDoc(adminRef);
    if (adminSnap.exists()) {
      adminEmails = adminSnap.data().emails || [];
    }
  } catch (error) {
    console.error("Error fetching admin config:", error);
  }
}

function isAdmin() {
  return currentUser && adminEmails.includes(currentUser.email);
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
const $$ = (sel) => document.querySelectorAll(sel);

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
const totalStudentsEl   = $("#totalStudents");
const totalMeritsEl     = $("#totalMerits");
const totalPointsLabel  = $("#totalPointsLabel");
const topHouseEl        = $("#topHouse");
const studentGrid       = $("#studentGrid");
const loadingState      = $("#loadingState");
const emptyState        = $("#emptyState");
const errorState        = $("#errorState");
const errorMessage      = $("#errorMessage");
const accessDenied      = $("#accessDenied");
const retryBtn          = $("#retryBtn");

/* Sidebar & Filter */
const houseSidebar     = $("#houseSidebar");
const sidebarHouseList = $("#sidebarHouseList");
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
const addTeacherBtn        = $("#addTeacherBtn");
const teacherBulkInput     = $("#teacherBulkInput");
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

/* ========================================
   STATE
   ======================================== */
let currentUser = null;
let currentStudent = null;
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
  console.log("Auth state changed:", user ? user.email : "null");
  if (user) {
    currentUser = user;
    await fetchAdminConfig();
    const isTeacher = await checkIfAllowed(user.email);
    if (isTeacher) {
      showDashboardView();
      setupRealTimeListener();
    } else {
      const student = await findStudentByEmail(user.email);
      if (student) {
        currentStudent = student;
        showStudentView();
        setupStudentListener();
      } else {
        showAccessDenied();
      }
    }
  } else {
    currentUser = null;
    currentStudent = null;
    showLogin();
    if (unsubscribeStudents) {
      unsubscribeStudents();
      unsubscribeStudents = null;
    }
    if (unsubscribeStudent) {
      unsubscribeStudent();
      unsubscribeStudent = null;
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
    return userSnap.exists();
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
  accessDenied.style.display = "none";
  userAvatar.src = currentUser?.photoURL || "";
  userAvatar.style.display = currentUser?.photoURL ? "block" : "none";
  userEmail.textContent = currentUser?.email || "";

  // Restore management buttons in header (admin only for Students/Teachers/Log)
  manageToggleBtn.style.display = isAdmin() ? "" : "none";
  teachersToggleBtn.style.display = isAdmin() ? "" : "none";
  logToggleBtn.style.display = isAdmin() ? "" : "none";
  scoreboardToggleBtn.style.display = "";
  studentView.style.display = "none";

  showLoading();
}

function showLoading() {
  loadingState.style.display = "flex";
  emptyState.style.display = "none";
  errorState.style.display = "none";
  studentGrid.style.display = "none";
  houseSidebar.style.display = "none";
}

function showAccessDenied() {
  loginScreen.style.display = "none";
  dashboardScreen.style.display = "flex";
  dashboardView.style.display = "none";
  manageView.style.display = "none";
  teachersView.style.display = "none";
  logView.style.display = "none";
  scoreboardView.style.display = "none";
  studentView.style.display = "none";
  loadingState.style.display = "none";
  emptyState.style.display = "none";
  errorState.style.display = "none";
  studentGrid.style.display = "none";
  houseSidebar.style.display = "none";
  accessDenied.style.display = "flex";
  userAvatar.src = currentUser?.photoURL || "";
  userAvatar.style.display = currentUser?.photoURL ? "block" : "none";
  userEmail.textContent = currentUser?.email || "";

  // Hide management buttons in header — unauthorized users must not see them
  manageToggleBtn.style.display = "none";
  teachersToggleBtn.style.display = "none";
  logToggleBtn.style.display = "none";
  scoreboardToggleBtn.style.display = "none";

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
  houseSidebar.style.display = "none";
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
  if (unsubscribeTeachers) { unsubscribeTeachers(); unsubscribeTeachers = null; }
  if (unsubscribeLog) { unsubscribeLog(); unsubscribeLog = null; }
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
  if (unsubscribeTeachers) { unsubscribeTeachers(); unsubscribeTeachers = null; }
  if (unsubscribeLog) { unsubscribeLog(); unsubscribeLog = null; }
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
  if (unsubscribeTeachers) { unsubscribeTeachers(); unsubscribeTeachers = null; }
  logView.style.display = "block";
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
  if (unsubscribeLog) { unsubscribeLog(); unsubscribeLog = null; }
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

      if (students.length === 0) {
        showEmptyState();
        updateStats([]);
        return;
      }

      renderStudents(students);
      updateStats(students);
      renderSidebar(students);
      loadingState.style.display = "none";
      emptyState.style.display = "none";
      errorState.style.display = "none";
      studentGrid.style.display = "grid";
      houseSidebar.style.display = "block";

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
  houseSidebar.style.display = "none";
}

/* ========================================
   RENDER DASHBOARD STUDENT GRID
   ======================================== */
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
    const byName = () => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
    if (sortBy === "name") return byName();
    const field = sortBy === "uniform" ? "uniformPoints" : "merits";
    const diff = (b[field] || 0) - (a[field] || 0);
    if (diff !== 0) return diff;
    return byName();
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

  const pointLabel = pointType === "uniform" ? "uniform" : "honor";

  studentGrid.innerHTML = filtered
    .map((student) => {
      const key = student.house.toLowerCase();
      const initials = student.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
      return `
        <div class="student-card student-card-${key}" id="student-${student.id}">
          <div class="student-avatar student-avatar-${key}">${initials}</div>
          <div class="student-info">
            <div class="student-name">${escapeHtml(student.name)}</div>
            <span class="student-house-badge house-badge-${key}">${student.house}</span>
            ${student.className ? `<span class="student-class-badge">${escapeHtml(student.className)}</span>` : ''}
          </div>
          <div class="student-points">
            <div class="point-controls">
              ${isAdmin() ? `<button class="merit-btn merit-btn-minus" data-type="${pointType}" data-student-id="${student.id}" data-student-name="${escapeHtml(student.name)}" data-house="${student.house}" title="Remove ${pointLabel} point from ${escapeHtml(student.name)}">−</button>` : ''}
              <span class="merit-count" id="${pointType}-${student.id}">${pointType === "uniform" ? (student.uniformPoints || 0) : (student.merits || 0)}</span>
              <button class="merit-btn merit-btn-plus" data-type="${pointType}" data-student-id="${student.id}" data-student-name="${escapeHtml(student.name)}" data-house="${student.house}" title="Give ${pointLabel} point to ${escapeHtml(student.name)}">+</button>
              ${isAdmin() ? `<button class="merit-btn merit-btn-plus25" data-type="${pointType}" data-student-id="${student.id}" data-student-name="${escapeHtml(student.name)}" data-house="${student.house}" title="Give 25 ${pointLabel} points (admin only)">+25</button>` : ''}
            </div>
          </div>
        </div>`;
    })
    .join("");

  document.querySelectorAll(".merit-btn-plus").forEach((btn) => {
    btn.addEventListener("click", handlePointClick);
  });
  document.querySelectorAll(".merit-btn-plus25").forEach((btn) => {
    btn.addEventListener("click", handlePointClick);
  });
  document.querySelectorAll(".merit-btn-minus").forEach((btn) => {
    btn.addEventListener("click", handlePointClick);
  });
}

/* ========================================
   GRID POINT TYPE TABS — Honor / Uniform
   ======================================== */
document.querySelectorAll(".grid-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    pointType = tab.dataset.pointType === "uniform" ? "uniform" : "honor";
    document.querySelectorAll(".grid-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.pointType === pointType);
    });
    renderStudents(allStudents);
    updateStats(allStudents);
  });
});

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ========================================
   CLASS FILTER — POPULATE OPTIONS
   ======================================== */
function populateClassFilter() {
  const classes = [...new Set(
    allStudents.map((s) => (s.className || "").trim()).filter(Boolean)
  )].sort();

  const current = classFilterSelect.value;
  classFilterSelect.innerHTML =
    `<option value="">All Classes</option>` +
    classes.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");

  // Restore selection if the class still exists
  classFilterSelect.value = classes.includes(current) ? current : "";
  if (!classes.includes(current)) selectedClass = null;
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
   SIDEBAR — CLICKABLE HOUSE LIST
   ======================================== */
function renderSidebar(students) {
  // Compute totals per house
  const houseData = {};
  for (const house of HOUSES) {
    const members = students.filter((s) => s.house === house);
    const total = members.reduce((s, st) => s + (st.merits || 0), 0);
    houseData[house] = { total, count: members.length };
  }

  // Sort by merits descending
  const sorted = Object.entries(houseData)
    .filter(([, d]) => d.count > 0)
    .sort(([, a], [, b]) => b.total - a.total);

  const totalStudents = students.length;

  // All Houses item
  let html = `
    <div class="sidebar-all-item${!selectedHouse ? " active" : ""}" data-house="">
      <div class="sidebar-all-icon">🏠</div>
      <span class="sidebar-all-name">All Houses</span>
      <span class="sidebar-all-count">${totalStudents}</span>
    </div>
  `;

  // Individual house items
  for (const [house, data] of sorted) {
    const key = house.toLowerCase();
    const isActive = selectedHouse === house;
    html += `
      <div class="sidebar-house-item${isActive ? " active active-" + key : ""}" data-house="${house}">
        <span class="sidebar-house-icon">${HOUSE_EMOJIS[house]}</span>
        <div class="sidebar-house-info">
          <div class="sidebar-house-name">${house}</div>
          <div class="sidebar-house-count">${data.count} student${data.count !== 1 ? "s" : ""}</div>
        </div>
        <span class="sidebar-house-merits">${data.total}</span>
      </div>`;
  }

  sidebarHouseList.innerHTML = html;

  // Attach click handlers — click on house items
  sidebarHouseList.querySelectorAll("[data-house]").forEach((el) => {
    el.addEventListener("click", () => {
      const house = el.dataset.house;
      // Toggle: clicking the same house deselects it
      if (house === selectedHouse) {
        selectedHouse = null;
      } else {
        selectedHouse = house || null;
      }
      renderSidebar(allStudents);
      renderStudents(allStudents);
    });
  });
}

/* ========================================
   CLEAR FILTER
   ======================================== */
clearFilterBtn.addEventListener("click", () => {
  selectedHouse = null;
  selectedClass = null;
  classFilterSelect.value = "";
  renderSidebar(allStudents);
  renderStudents(allStudents);
});

/* ========================================
   UPDATE STATS
   ======================================== */
function updateStats(students) {
  totalStudentsEl.textContent = students.length;

  const field = pointType === "uniform" ? "uniformPoints" : "merits";
  const totalPoints = students.reduce((s, st) => s + (st[field] || 0), 0);
  totalMeritsEl.textContent = totalPoints;
  totalPointsLabel.textContent = pointType === "uniform" ? "Total Uniform" : "Total Honors";

  const houseTotals = {};
  for (const s of students) {
    houseTotals[s.house] = (houseTotals[s.house] || 0) + (s[field] || 0);
  }
  let topHouse = "—", topScore = -1;
  for (const [h, sc] of Object.entries(houseTotals)) {
    if (sc > topScore) { topScore = sc; topHouse = h; }
  }
  topHouseEl.textContent = topHouse;
}

/* ========================================
   SCOREBOARD — FULL PAGE HOUSE RANKING
   ======================================== */
function renderScoreboard() {
  const students = allStudents;
  const field = scoreboardType === "uniform" ? "uniformPoints" : "merits";
  const label = scoreboardType === "uniform" ? "Uniform" : "Honors";

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
async function handlePointClick(e) {
  const btn = e.currentTarget;
  const studentId = btn.dataset.studentId;
  const studentName = btn.dataset.studentName;
  const house = btn.dataset.house || "";
  const type = btn.dataset.type === "uniform" ? "uniform" : "honor";
  const isMinus = btn.classList.contains("merit-btn-minus");
  const isPlus25 = btn.classList.contains("merit-btn-plus25");
  const change = isMinus ? -1 : (isPlus25 ? 25 : 1);
  const label = type === "uniform" ? "uniform point" : "honor point";
  const pluralLabel = Math.abs(change) === 1 ? label : label + "s";

  // Minus buttons can't go below zero
  if (isMinus) {
    const student = allStudents.find(s => s.id === studentId);
    const current = type === "uniform" ? (student?.uniformPoints || 0) : (student?.merits || 0);
    if (!student || current <= 0) {
      showToast(`${studentName} has no ${label}s to remove.`, "error");
      return;
    }
  }

  btn.disabled = true;
  try {
    const update = type === "uniform"
      ? { uniformPoints: increment(change) }
      : { merits: increment(change) };
    await updateDoc(doc(db, "students", studentId), update);
    await addDoc(collection(db, "meritLog"), {
      studentId,
      studentName,
      house,
      type,
      teacherEmail: currentUser.email,
      timestamp: serverTimestamp(),
      change
    });

    const countEl = document.getElementById(`${type}-${studentId}`);
    if (countEl) {
      countEl.classList.remove("merit-pop");
      void countEl.offsetWidth;
      countEl.classList.add("merit-pop");
    }
    showToast(change > 0 ? `+${change} ${pluralLabel} for ${studentName}! 🎉` : `-${Math.abs(change)} ${pluralLabel} for ${studentName}`, change > 0 ? "success" : "info");
    setTimeout(() => { btn.disabled = false; }, 400);
  } catch (error) {
    console.error("Error updating points:", error);
    showToast("Failed to update points. Please try again.", "error");
    btn.disabled = false;
  }
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
      snapshot.forEach((d) => teachers.push({ id: d.id, email: d.data().email || "—" }));
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
    teacherTableBody.innerHTML = `<tr><td colspan="2" class="student-table-empty">No teachers added yet.</td></tr>`;
    return;
  }

  teacherTableBody.innerHTML = teachers
    .map(
      (t) => `
      <tr>
        <td>${escapeHtml(t.email)}</td>
        <td style="width:60px;">
          <button class="btn-icon delete-teacher-btn" data-teacher-email="${escapeHtml(t.id)}" title="Remove ${escapeHtml(t.email)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </td>
      </tr>`
    )
    .join("");

  document.querySelectorAll(".delete-teacher-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
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
  });
}

/* ========================================
   HOME LINK — click logo to go to dashboard
   ======================================== */
document.getElementById("homeLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  manageView.style.display = "none";
  teachersView.style.display = "none";
  logView.style.display = "none";
  scoreboardView.style.display = "none";
  dashboardView.style.display = "block";
  if (unsubscribeTeachers) { unsubscribeTeachers(); unsubscribeTeachers = null; }
  if (unsubscribeLog) { unsubscribeLog(); unsubscribeLog = null; }
});

/* ========================================
   RESET ALL MERITS (admin only)
   ======================================== */
document.getElementById("resetMeritsBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;
  const count = allStudents.length;
  if (count === 0) { showToast("No students to reset.", "error"); return; }
  if (!confirm(`Reset ALL honor and uniform points for ${count} student${count !== 1 ? "s" : ""} to 0? This cannot be undone.`)) return;

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

  if (!email) { showToast("Please enter the teacher's email.", "error"); return; }
  if (!email.includes("@")) { showToast("Please enter a valid email address.", "error"); return; }

  addTeacherBtn.disabled = true;
  addTeacherBtn.textContent = "Adding...";

  try {
    // Use email as the document ID
    const ref = doc(db, "allowedUsers", email);
    await setDoc(ref, { email });
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
  const q = query(logRef, orderBy("timestamp", "desc"), limit(100));

  unsubscribeLog = onSnapshot(
    q,
    (snapshot) => {
      const entries = [];
      snapshot.forEach((d) => entries.push({ id: d.id, ...d.data() }));
      renderLogList(entries);
    },
    (error) => {
      console.error("Log listener error:", error);
      showToast("Failed to load activity log.", "error");
    }
  );
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

function renderLogList(entries) {
  logCount.textContent = entries.length;

  if (entries.length === 0) {
    logTableBody.innerHTML = `<tr><td colspan="5" class="student-table-empty">No merit activity yet.</td></tr>`;
    return;
  }

  logTableBody.innerHTML = entries
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml(e.studentName || "—")}</td>
        <td>${e.house ? `<span class="house-dot house-dot-${e.house.toLowerCase()}"></span>${escapeHtml(e.house)}` : "—"}</td>
        <td>${e.type === "uniform" ? "Uniform" : "Honor"}${typeof e.change === "number" ? ` ${e.change > 0 ? "+" : ""}${e.change}` : ""}</td>
        <td>${escapeHtml(e.teacherEmail || "—")}</td>
        <td style="white-space:nowrap;color:var(--color-text-tertiary);font-size:0.8rem;">${formatTime(e.timestamp)}</td>
      </tr>`
    )
    .join("");
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

  addTeachersBulkBtn.disabled = true;
  addTeachersBulkBtn.textContent = `Adding ${emails.length}...`;

  try {
    const batch = writeBatch(db);
    for (const email of emails) {
      const ref = doc(db, "allowedUsers", email);
      batch.set(ref, { email });
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
   ========================================

// Click upload area to trigger file input
uploadArea.addEventListener("click", () => fileInput.click());

// Drag-and-drop support
uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("drag-over");
});
uploadArea.addEventListener("dragleave", () => {
  uploadArea.classList.remove("drag-over");
});
uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("drag-over");
  if (e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    handleFile(fileInput.files[0]);
    fileInput.value = "";
  }
});

function handleFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["xlsx", "xls", "csv"].includes(ext)) {
    showToast("Unsupported file format. Please use .xlsx, .xls, or .csv", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
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
  };
  reader.readAsArrayBuffer(file);
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
downloadTemplateBtn.addEventListener("click", () => {
  const rows = [
    ["Name", "House", "Class", "Email"],
    ["Alice Chen", "Green", "7A", "alice.chen@school.edu"],
    ["Benjamin Park", "Blue", "7B", "benjamin.park@school.edu"]
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");
  XLSX.writeFile(wb, "sisb-honor-students-template.xlsx");
  showToast("Template downloaded! Fill it in and drop it below.", "info");
});

/* ========================================
   MANAGE — STUDENT LIST & DELETE
   ======================================== */
function renderManageStudentList() {
  if (allStudents.length === 0) {
    manageStudentBody.innerHTML = `<tr><td colspan="6" class="student-table-empty">No students yet. Add some above!</td></tr>`;
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
        <td>${escapeHtml(s.house)}</td>
        <td>${escapeHtml(s.className || "—")}</td>
        <td>${s.merits || 0}</td>
        <td>${s.uniformPoints || 0}</td>
        <td>
          <span class="student-email-cell">${escapeHtml(s.email || "—")}</span>
          <button class="btn-icon edit-email-btn" data-student-id="${s.id}" data-student-name="${escapeHtml(s.name)}" data-email="${escapeAttr(s.email || "")}" title="Set email for ${escapeHtml(s.name)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </td>
        <td>
          <button class="btn-icon delete-btn" data-student-id="${s.id}" data-student-name="${escapeHtml(s.name)}" title="Delete ${escapeHtml(s.name)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </td>
      </tr>`
    )
    .join("");

  // Attach email edit handlers
  document.querySelectorAll(".edit-email-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!isAdmin()) { showToast("Only the admin can edit student emails.", "error"); return; }
      const id = btn.dataset.studentId;
      const name = btn.dataset.studentName;
      const current = btn.dataset.email || "";
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
    });
  });

  // Attach delete handlers
  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!isAdmin()) { showToast("Only the admin can delete students.", "error"); return; }
      const id = btn.dataset.studentId;
      const name = btn.dataset.studentName;
      if (confirm(`Delete ${name}? This cannot be undone.`)) {
        try {
          await deleteDoc(doc(db, "students", id));
          showToast(`Deleted ${name}.`, "info");
        } catch (error) {
          console.error("Error deleting student:", error);
          showToast("Failed to delete student. Please try again.", "error");
        }
      }
    });
  });
}
