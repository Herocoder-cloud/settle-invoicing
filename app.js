import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ============================================================
// Currency conversion
// ============================================================
// We fetch live rates once per session from a free, no-key API.
// If that fails (offline, API down), we fall back to a static
// table so the dashboard still works -- just slightly less accurate.
// Rates are expressed as "how many of this currency equals 1 USD".
let exchangeRates = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.5,
  AUD: 1.52,
  CAD: 1.36
};

async function loadExchangeRates() {
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await res.json();
    if (data && data.rates) {
      exchangeRates = { USD: 1, ...data.rates };
    }
  } catch (err) {
    console.warn('Could not fetch live exchange rates, using fallback table.', err);
  }
}

function convertToINR(amount, currency) {
  const rateForCurrency = exchangeRates[currency] || 1;
  const rateForINR = exchangeRates.INR || 83.5;
  // amount in `currency` -> USD -> INR
  const amountInUSD = amount / rateForCurrency;
  return amountInUSD * rateForINR;
}

function formatMoney(amount, currency) {
  return `${currency} ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatINR(amount) {
  return `Rs. ${Math.round(amount).toLocaleString('en-IN')}`;
}

// ============================================================
// Element refs
// ============================================================
const authScreen = document.getElementById('authScreen');
const appScreen = document.getElementById('appScreen');
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const authTabs = document.querySelectorAll('.auth-tab');
const loginError = document.getElementById('loginError');
const signupError = document.getElementById('signupError');
const userEmailEl = document.getElementById('userEmail');
const logoutBtn = document.getElementById('logoutBtn');

const statOutstanding = document.getElementById('statOutstanding');
const statOverdue = document.getElementById('statOverdue');
const statPaid = document.getElementById('statPaid');
const statClients = document.getElementById('statClients');

const clientsList = document.getElementById('clientsList');
const clientsEmpty = document.getElementById('clientsEmpty');
const addClientBtn = document.getElementById('addClientBtn');

const invoicesList = document.getElementById('invoicesList');
const invoicesEmpty = document.getElementById('invoicesEmpty');
const addInvoiceBtn = document.getElementById('addInvoiceBtn');
const filterChips = document.querySelectorAll('.filter-chip');

const clientModal = document.getElementById('clientModal');
const clientForm = document.getElementById('clientForm');
const clientEditId = document.getElementById('clientEditId');
const clientError = document.getElementById('clientError');

const invoiceModal = document.getElementById('invoiceModal');
const invoiceForm = document.getElementById('invoiceForm');
const invoiceEditId = document.getElementById('invoiceEditId');
const invoiceError = document.getElementById('invoiceError');
const invoiceModalTitle = document.getElementById('invoiceModalTitle');
const iClientSelect = document.getElementById('iClient');

let clients = [];
let invoices = [];
let currentFilter = 'all';
let unsubClients = null;
let unsubInvoices = null;

// ============================================================
// Auth
// ============================================================
authTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    authTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    if (tab.dataset.tab === 'login') {
      loginForm.classList.remove('hidden');
      signupForm.classList.add('hidden');
    } else {
      signupForm.classList.remove('hidden');
      loginForm.classList.add('hidden');
    }
  });
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value, document.getElementById('loginPassword').value);
  } catch (err) {
    loginError.textContent = friendlyError(err.code);
  }
});

signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  signupError.textContent = '';
  try {
    await createUserWithEmailAndPassword(auth, document.getElementById('signupEmail').value, document.getElementById('signupPassword').value);
  } catch (err) {
    signupError.textContent = friendlyError(err.code);
  }
});

logoutBtn.addEventListener('click', () => signOut(auth));

function friendlyError(code) {
  const map = {
    'auth/email-already-in-use': 'That email is already registered -- try logging in instead.',
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/weak-password': 'Password needs to be at least 6 characters.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'Incorrect password.'
  };
  return map[code] || 'Something went wrong. Please try again.';
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    userEmailEl.textContent = user.email;
    await loadExchangeRates();
    subscribeToClients(user.uid);
    subscribeToInvoices(user.uid);
  } else {
    appScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
    if (unsubClients) unsubClients();
    if (unsubInvoices) unsubInvoices();
    clients = [];
    invoices = [];
  }
});

// ============================================================
// Firestore subscriptions
// ============================================================
function subscribeToClients(uid) {
  const q = query(collection(db, 'clients'), where('userId', '==', uid));
  unsubClients = onSnapshot(q, (snapshot) => {
    clients = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderClients();
    populateClientDropdown();
    renderStats();
  });
}

function subscribeToInvoices(uid) {
  const q = query(collection(db, 'invoices'), where('userId', '==', uid));
  unsubInvoices = onSnapshot(q, (snapshot) => {
    invoices = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    invoices.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    markOverdueInvoices();
    renderInvoices();
    renderStats();
  });
}

function effectiveStatus(invoice) {
  if (invoice.status === 'sent') {
    const due = new Date(invoice.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (due < today) return 'overdue';
  }
  return invoice.status;
}

function markOverdueInvoices() {
  invoices = invoices.map(inv => ({ ...inv, _effectiveStatus: effectiveStatus(inv) }));
}

// ============================================================
// Stats
// ============================================================
function renderStats() {
  const outstanding = invoices
    .filter(inv => inv._effectiveStatus === 'sent' || inv._effectiveStatus === 'overdue')
    .reduce((sum, inv) => sum + convertToINR(Number(inv.amount), inv.currency), 0);

  const overdueCount = invoices.filter(inv => inv._effectiveStatus === 'overdue').length;

  const now = new Date();
  const paidThisMonth = invoices
    .filter(inv => {
      if (inv._effectiveStatus !== 'paid') return false;
      const issue = new Date(inv.issueDate);
      return issue.getMonth() === now.getMonth() && issue.getFullYear() === now.getFullYear();
    })
    .reduce((sum, inv) => sum + convertToINR(Number(inv.amount), inv.currency), 0);

  statOutstanding.textContent = formatINR(outstanding);
  statOverdue.textContent = overdueCount;
  statPaid.textContent = formatINR(paidThisMonth);
  statClients.textContent = clients.length;
}

// ============================================================
// Clients
// ============================================================
addClientBtn.addEventListener('click', () => openClientModal());

function openClientModal(client) {
  clientForm.reset();
  clientError.textContent = '';
  if (client) {
    clientEditId.value = client.id;
    document.getElementById('cName').value = client.name;
    document.getElementById('cEmail').value = client.email || '';
    document.getElementById('cCountry').value = client.country || '';
    document.getElementById('cCurrency').value = client.currency;
  } else {
    clientEditId.value = '';
  }
  clientModal.classList.remove('hidden');
}

clientForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clientError.textContent = '';
  const user = auth.currentUser;
  if (!user) return;

  const data = {
    name: document.getElementById('cName').value.trim(),
    email: document.getElementById('cEmail').value.trim(),
    country: document.getElementById('cCountry').value.trim(),
    currency: document.getElementById('cCurrency').value,
    userId: user.uid
  };

  try {
    const editId = clientEditId.value;
    if (editId) {
      await updateDoc(doc(db, 'clients', editId), data);
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, 'clients'), data);
    }
    clientModal.classList.add('hidden');
  } catch (err) {
    clientError.textContent = 'Could not save client. Please try again.';
    console.error(err);
  }
});

function renderClients() {
  clientsList.innerHTML = '';
  if (clients.length === 0) {
    clientsEmpty.classList.remove('hidden');
    return;
  }
  clientsEmpty.classList.add('hidden');

  clients.forEach(client => {
    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <div>
        <div class="client-name">${escapeHtml(client.name)}</div>
        <div class="client-meta">${escapeHtml(client.country || 'No country set')} - ${escapeHtml(client.currency)}</div>
      </div>
      <div class="client-actions">
        <button class="icon-btn edit-client-btn" data-id="${client.id}" title="Edit">Edit</button>
        <button class="icon-btn danger delete-client-btn" data-id="${client.id}" title="Delete">Del</button>
      </div>
    `;
    clientsList.appendChild(row);
  });

  clientsList.querySelectorAll('.edit-client-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const client = clients.find(c => c.id === btn.dataset.id);
      if (client) openClientModal(client);
    });
  });

  clientsList.querySelectorAll('.delete-client-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const hasInvoices = invoices.some(inv => inv.clientId === btn.dataset.id);
      if (hasInvoices) {
        alert('This client has invoices attached. Delete those first, or keep the client for record-keeping.');
        return;
      }
      if (confirm('Delete this client?')) {
        await deleteDoc(doc(db, 'clients', btn.dataset.id));
      }
    });
  });
}

function populateClientDropdown() {
  iClientSelect.innerHTML = clients
    .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join('');
}

// ============================================================
// Invoices
// ============================================================
addInvoiceBtn.addEventListener('click', () => {
  if (clients.length === 0) {
    alert('Add a client first, then you can create an invoice for them.');
    return;
  }
  openInvoiceModal();
});

filterChips.forEach(chip => {
  chip.addEventListener('click', () => {
    filterChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    renderInvoices();
  });
});

function openInvoiceModal(invoice) {
  invoiceForm.reset();
  invoiceError.textContent = '';
  populateClientDropdown();

  if (invoice) {
    invoiceModalTitle.textContent = 'Edit invoice';
    invoiceEditId.value = invoice.id;
    document.getElementById('iClient').value = invoice.clientId;
    document.getElementById('iNumber').value = invoice.invoiceNumber;
    document.getElementById('iAmount').value = invoice.amount;
    document.getElementById('iCurrency').value = invoice.currency;
    document.getElementById('iIssueDate').value = invoice.issueDate;
    document.getElementById('iDueDate').value = invoice.dueDate;
    document.getElementById('iStatus').value = invoice.status;
    document.getElementById('iNotes').value = invoice.notes || '';
  } else {
    invoiceModalTitle.textContent = 'New invoice';
    invoiceEditId.value = '';
    document.getElementById('iIssueDate').value = new Date().toISOString().split('T')[0];
    const due = new Date();
    due.setDate(due.getDate() + 14);
    document.getElementById('iDueDate').value = due.toISOString().split('T')[0];
    document.getElementById('iNumber').value = `INV-${String(invoices.length + 1).padStart(3, '0')}`;
  }
  invoiceModal.classList.remove('hidden');
}

invoiceForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  invoiceError.textContent = '';
  const user = auth.currentUser;
  if (!user) return;

  const clientId = document.getElementById('iClient').value;
  const client = clients.find(c => c.id === clientId);
  if (!client) {
    invoiceError.textContent = 'Please select a client.';
    return;
  }

  const data = {
    clientId,
    clientName: client.name,
    invoiceNumber: document.getElementById('iNumber').value.trim(),
    amount: Number(document.getElementById('iAmount').value),
    currency: document.getElementById('iCurrency').value,
    issueDate: document.getElementById('iIssueDate').value,
    dueDate: document.getElementById('iDueDate').value,
    status: document.getElementById('iStatus').value,
    notes: document.getElementById('iNotes').value.trim(),
    userId: user.uid
  };

  try {
    const editId = invoiceEditId.value;
    if (editId) {
      await updateDoc(doc(db, 'invoices', editId), data);
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, 'invoices'), data);
    }
    invoiceModal.classList.add('hidden');
  } catch (err) {
    invoiceError.textContent = 'Could not save invoice. Please try again.';
    console.error(err);
  }
});

function renderInvoices() {
  const filtered = currentFilter === 'all'
    ? invoices
    : invoices.filter(inv => inv._effectiveStatus === currentFilter);

  invoicesList.innerHTML = '';

  if (filtered.length === 0) {
    invoicesEmpty.classList.remove('hidden');
    return;
  }
  invoicesEmpty.classList.add('hidden');

  filtered.forEach(inv => {
    const card = document.createElement('div');
    card.className = 'invoice-card';
    card.innerHTML = `
      <div class="invoice-top">
        <div>
          <div class="invoice-number">${escapeHtml(inv.invoiceNumber)}</div>
          <div class="invoice-client">${escapeHtml(inv.clientName)}</div>
        </div>
        <div style="text-align:right;">
          <div class="invoice-amount">${formatMoney(Number(inv.amount), inv.currency)}</div>
          <span class="status-badge status-${inv._effectiveStatus}">${inv._effectiveStatus}</span>
        </div>
      </div>
      <div class="invoice-dates">Issued ${formatDate(inv.issueDate)} - Due ${formatDate(inv.dueDate)}</div>
      <div class="invoice-actions">
        ${inv.status !== 'paid' ? `<button class="mini-btn success mark-paid-btn" data-id="${inv.id}">Mark paid</button>` : ''}
        <button class="mini-btn pdf-btn" data-id="${inv.id}">Download PDF</button>
        <button class="mini-btn edit-invoice-btn" data-id="${inv.id}">Edit</button>
        <button class="mini-btn danger delete-invoice-btn" data-id="${inv.id}">Delete</button>
      </div>
    `;
    invoicesList.appendChild(card);
  });

  invoicesList.querySelectorAll('.mark-paid-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await updateDoc(doc(db, 'invoices', btn.dataset.id), { status: 'paid' });
    });
  });

  invoicesList.querySelectorAll('.edit-invoice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const inv = invoices.find(i => i.id === btn.dataset.id);
      if (inv) openInvoiceModal(inv);
    });
  });

  invoicesList.querySelectorAll('.delete-invoice-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Delete this invoice?')) {
        await deleteDoc(doc(db, 'invoices', btn.dataset.id));
      }
    });
  });

  invoicesList.querySelectorAll('.pdf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const inv = invoices.find(i => i.id === btn.dataset.id);
      if (inv) generateInvoicePDF(inv);
    });
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ============================================================
// PDF generation
// ============================================================
function generateInvoicePDF(inv) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('INVOICE', 20, 25);

  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Invoice #: ${inv.invoiceNumber}`, 20, 35);
  doc.text(`Issue date: ${formatDate(inv.issueDate)}`, 20, 41);
  doc.text(`Due date: ${formatDate(inv.dueDate)}`, 20, 47);

  doc.setFont(undefined, 'bold');
  doc.text('Billed to:', 20, 60);
  doc.setFont(undefined, 'normal');
  doc.text(inv.clientName, 20, 66);

  doc.setDrawColor(200);
  doc.line(20, 80, 190, 80);

  doc.setFont(undefined, 'bold');
  doc.text('Description', 20, 90);
  doc.text('Amount', 160, 90);
  doc.line(20, 94, 190, 94);

  doc.setFont(undefined, 'normal');
  const notes = inv.notes || 'Professional services';
  doc.text(notes, 20, 102, { maxWidth: 120 });
  doc.text(formatMoney(Number(inv.amount), inv.currency), 160, 102);

  doc.line(20, 115, 190, 115);
  doc.setFont(undefined, 'bold');
  doc.text('Total', 20, 123);
  doc.text(formatMoney(Number(inv.amount), inv.currency), 160, 123);

  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text('Generated with Settle -- a freelance invoice tracker.', 20, 280);

  doc.save(`${inv.invoiceNumber}-${inv.clientName.replace(/\s+/g, '-')}.pdf`);
}

// ============================================================
// Modal close handling (shared)
// ============================================================
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.close).classList.add('hidden');
  });
});
[clientModal, invoiceModal].forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
});
