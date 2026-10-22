/**
 * EnergySense - IoT Based Smart Energy Monitoring System
 * Frontend Application Controller
 * 
 * Features:
 * - Dynamic status evaluation based on real ThingSpeak feed age
 * - Non-intrusive dashboard alerts (Strictly in-dashboard, NO SMS)
 * - Safe numeric parsing (never displays NaN, null, undefined)
 * - Multi-chart interactive visualizations using Chart.js
 * - Real-time polling with configurable intervals
 * - SPA Tab Navigation and responsive sidebar
 */

// ==============================================================================
// State & Configuration
// ==============================================================================
const AppState = {
  currentTab: 'dashboard',
  pollingIntervalMs: 15000,
  pollTimer: null,
  isFetching: false,
  trendRange: 20,
  analyticsRange: 20,
  charts: {},
  oled: {
    mode: 'auto', // 'auto', 's1', 's2'
    activeScreen: 0, // 0 = Screen 1, 1 = Screen 2
    timer: null,
    lastMetrics: null
  },
  settings: {
    channel_id: '',
    read_api_key: '',
    data_timeout: 60,
    refresh_interval: 15
  },
  minMax: {
    voltage: { min: Infinity, max: -Infinity },
    current: { min: Infinity, max: -Infinity },
    power: { min: Infinity, max: -Infinity }
  }
};

// ==============================================================================
// Initialization
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Setup Event Listeners
  setupNavigation();
  setupSidebar();
  setupSettingsForm();
  setupControls();
  setupOled();

  // Initialize Charts
  initCharts();

  // Load initial settings and trigger first poll
  loadSettings().then(() => {
    fetchLatestData();
    fetchHistoryData();
    startPolling();
  });
});

// ==============================================================================
// Navigation & Sidebar
// ==============================================================================
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = item.getAttribute('data-tab');
      switchTab(tab);

      // Close mobile sidebar if open
      closeMobileSidebar();
    });
  });
}

function switchTab(tabName) {
  AppState.currentTab = tabName;

  // Update nav active class
  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.getAttribute('data-tab') === tabName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Switch tab view
  document.querySelectorAll('.tab-view').forEach(view => {
    if (view.id === `view-${tabName}`) {
      view.classList.add('active');
    } else {
      view.classList.remove('active');
    }
  });

  // Re-render / update charts for specific tabs
  if (tabName === 'dashboard') {
    if (AppState.charts.liveTrend) AppState.charts.liveTrend.resize();
    if (AppState.charts.energy) AppState.charts.energy.resize();
  } else if (tabName === 'live') {
    if (AppState.charts.liveStream) AppState.charts.liveStream.resize();
  } else if (tabName === 'analytics') {
    fetchHistoryData(AppState.analyticsRange);
  } else if (tabName === 'settings') {
    loadSettings();
  }

  // Refresh icons for new view
  if (window.lucide) window.lucide.createIcons();
}

function setupSidebar() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const sidebar = document.getElementById('sidebar');

  function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('active');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('active');
  }

  if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openSidebar);
  if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.remove('open');
  if (sidebarOverlay) sidebarOverlay.classList.remove('active');
}

function setupControls() {
  // Manual refresh button
  const refreshBtn = document.getElementById('manualRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const icon = document.getElementById('refreshIcon');
      if (icon) icon.classList.add('spinning');
      Promise.all([fetchLatestData(), fetchHistoryData()]).finally(() => {
        setTimeout(() => {
          if (icon) icon.classList.remove('spinning');
        }, 600);
      });
    });
  }

  // Live Trend Range Select
  const trendSelect = document.getElementById('trendRangeSelect');
  if (trendSelect) {
    trendSelect.addEventListener('change', (e) => {
      AppState.trendRange = parseInt(e.target.value, 10);
      fetchHistoryData(AppState.trendRange);
    });
  }

  // Analytics Range Select
  const analyticsSelect = document.getElementById('analyticsRangeSelect');
  if (analyticsSelect) {
    analyticsSelect.addEventListener('change', (e) => {
      AppState.analyticsRange = parseInt(e.target.value, 10);
      fetchHistoryData(AppState.analyticsRange);
    });
  }
}

// ==============================================================================
// Safe Formatting & Timezone Helpers (Asia/Kolkata - IST)
// ==============================================================================
function formatVal(val, decimals = 2, defaultStr = '--') {
  if (val === null || val === undefined || isNaN(val)) {
    return defaultStr;
  }
  return Number(val).toFixed(decimals);
}

function safeGet(val, defaultVal = '--') {
  if (val === null || val === undefined || val === '') {
    return defaultVal;
  }
  return val;
}

/**
 * Robust UTC to Asia/Kolkata (IST) timezone converter using Intl.DateTimeFormat.
 * Treats all ThingSpeak created_at timestamps as UTC and converts to IST (UTC+5:30)
 * without manual offset arithmetic.
 * 
 * @param {string|Date} ts - UTC timestamp string (e.g. "2026-09-20T10:30:00Z")
 * @param {'chart'|'time'|'full'} formatType - Format mode:
 *        'chart': "20 Sep, 4:00 PM" (used for Live Data Trend & Energy charts)
 *        'time':  "4:00:00 PM"
 *        'full':  "20 Sep 2026, 4:00:00 PM"
 * @returns {string} Formatted IST timestamp string
 */
function formatToIST(ts, formatType = 'chart') {
  if (!ts) return '--';
  try {
    let dateObj;
    if (ts instanceof Date) {
      dateObj = ts;
    } else {
      let tsStr = String(ts).trim();
      if (!tsStr) return '--';
      // Ensure ISO string without explicit timezone is treated as UTC
      if (!tsStr.endsWith('Z') && !tsStr.includes('+') && !tsStr.includes('-', 10)) {
        tsStr = tsStr + 'Z';
      }
      dateObj = new Date(tsStr);
    }

    if (isNaN(dateObj.getTime())) {
      return String(ts);
    }

    // Explicitly target Asia/Kolkata timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    const parts = formatter.formatToParts(dateObj);
    const partMap = {};
    for (const p of parts) {
      partMap[p.type] = p.value;
    }

    const day = partMap.day || '';
    const month = partMap.month || '';
    const year = partMap.year || '';
    const hour = partMap.hour || '';
    const minute = partMap.minute || '00';
    const second = partMap.second || '00';
    const period = (partMap.dayPeriod || '').toUpperCase();

    if (formatType === 'chart') {
      return `${day} ${month}, ${hour}:${minute} ${period}`;
    } else if (formatType === 'time') {
      return `${hour}:${minute}:${second} ${period}`;
    } else if (formatType === 'full') {
      return `${day} ${month} ${year}, ${hour}:${minute}:${second} ${period}`;
    }

    return `${day} ${month}, ${hour}:${minute} ${period}`;
  } catch (error) {
    console.warn('Error converting timestamp to IST:', error);
    return String(ts);
  }
}

// ==============================================================================
// Polling Manager
// ==============================================================================
function startPolling() {
  if (AppState.pollTimer) {
    clearInterval(AppState.pollTimer);
  }
  AppState.pollTimer = setInterval(() => {
    fetchLatestData();
    // Periodically sync history data as well
    if (AppState.currentTab === 'dashboard' || AppState.currentTab === 'live' || AppState.currentTab === 'analytics') {
      const count = AppState.currentTab === 'analytics' ? AppState.analyticsRange : AppState.trendRange;
      fetchHistoryData(count);
    }
  }, AppState.pollingIntervalMs);
}

// ==============================================================================
// Data Fetching: Latest Data & Dynamic Status
// ==============================================================================
async function fetchLatestData() {
  if (AppState.isFetching) return;
  AppState.isFetching = true;

  try {
    const response = await fetch('/api/energy/latest');
    if (!response.ok && response.status !== 400) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const data = await response.json();
    updateUIWithLatestData(data);
  } catch (error) {
    console.warn('ThingSpeak communication blip:', error);
    renderErrorState(error.message);
  } finally {
    AppState.isFetching = false;
  }
}

function updateUIWithLatestData(data) {
  const metrics = data.metrics || {};
  const devStatus = data.device_status || {};
  const insights = data.insights || {};

  // 1. Update Connection Status in Topbar & Cards
  updateConnectionStatus(devStatus, formatToIST(data.last_update, 'time'));

  // 2. Update KPI Cards on Dashboard
  document.getElementById('kpiVoltage').innerText = formatVal(metrics.voltage, 1);
  document.getElementById('kpiCurrent').innerText = formatVal(metrics.current, 2);
  document.getElementById('kpiPower').innerText = formatVal(metrics.power, 1);
  document.getElementById('kpiEnergy').innerText = formatVal(metrics.energy, 2);
  document.getElementById('kpiBill').innerText = formatVal(metrics.bill_amount, 2);

  // Hero Card Live Power
  document.getElementById('heroEcoPower').innerText = `${formatVal(metrics.power, 1)} W`;

  // Sustainability Index calculation (based on voltage stability and load demand)
  if (metrics.voltage !== null && metrics.voltage !== undefined && !isNaN(metrics.voltage)) {
    const vDiff = Math.abs(metrics.voltage - 230);
    const ecoScore = Math.max(40, Math.min(100, Math.round(100 - (vDiff * 1.5))));
    document.getElementById('kpiEcoScore').innerText = ecoScore;
  } else {
    document.getElementById('kpiEcoScore').innerText = '--';
  }

  // Dashboard Chart Header Callouts
  document.getElementById('dashTotalEnergy').innerText = `${formatVal(metrics.energy, 2)} kWh`;
  document.getElementById('dashEstBill').innerText = `₹ ${formatVal(metrics.bill_amount, 2)}`;

  // 3. Update Live Tab Cards & Progress Bars
  updateLiveTabMetrics(metrics);

  // 4. Update Billing Tab
  updateBillingTab(metrics);

  // 5. Update Diagnostics Tab
  updateDiagnosticsTab(data);

  // 6. Update ESP32 OLED Display Mirror
  updateOledDisplay(metrics);

  // 7. Update Quick Insights
  updateQuickInsights(insights);

  // 8. Render In-Dashboard Alerts (Strictly NO SMS)
  renderDashboardAlerts(insights.alerts || []);
}

function updateConnectionStatus(devStatus, lastTimeStr) {
  const topbarBadge = document.getElementById('topbarStatusBadge');
  const topbarText = document.getElementById('topbarStatusText');
  const topbarTime = document.getElementById('topbarTime');
  const deviceBadge = document.getElementById('deviceViewStatusBadge');
  const deviceBadgeText = document.getElementById('deviceViewStatusText');

  const statusDataLink = document.getElementById('statusDataLink');
  const statusEsp32 = document.getElementById('statusEsp32');
  const statusThingSpeak = document.getElementById('statusThingSpeak');
  const statusLastUpdate = document.getElementById('statusLastUpdate');
  const statusAgeSub = document.getElementById('statusAgeSub');

  if (lastTimeStr) {
    topbarTime.innerText = lastTimeStr;
    if (statusLastUpdate) statusLastUpdate.innerText = lastTimeStr;
  }

  if (devStatus.age_seconds !== null && devStatus.age_seconds !== undefined) {
    if (statusAgeSub) statusAgeSub.innerText = `Age: ${devStatus.age_seconds}s ago`;
  }

  // Status mapping
  if (devStatus.is_online) {
    // ONLINE
    topbarBadge.className = 'status-pill status-online';
    topbarText.innerText = 'ESP32 Online';

    if (deviceBadge) {
      deviceBadge.className = 'status-pill status-online';
      deviceBadgeText.innerText = 'System Online';
    }

    // Device Status Card Badges
    setBadge(statusDataLink, 'badge-connected', 'Connected');
    setBadge(statusEsp32, 'badge-online', 'Online');
    setBadge(statusThingSpeak, 'badge-updating', 'Updating');

    // Topology Nodes
    setNodeBadge('nodeEsp32Status', 'Online', 'badge-online');
    setNodeBadge('nodeWifiStatus', 'Connected', 'badge-connected');
    setNodeBadge('nodeCloudStatus', 'Updating', 'badge-updating');
  } else {
    // OFFLINE or UNCONFIGURED
    topbarBadge.className = 'status-pill status-offline';
    topbarText.innerText = devStatus.esp32 === 'WAITING CONFIG' ? 'Waiting Config' : 'ESP32 Offline';

    if (deviceBadge) {
      deviceBadge.className = 'status-pill status-offline';
      deviceBadgeText.innerText = 'System Offline';
    }

    setBadge(statusDataLink, 'badge-disconnected', devStatus.data_link || 'Inactive');
    setBadge(statusEsp32, 'badge-offline', devStatus.esp32 || 'Offline');
    setBadge(statusThingSpeak, 'badge-not-updating', devStatus.thingspeak || 'Not Updating');

    setNodeBadge('nodeEsp32Status', devStatus.esp32 || 'Offline', 'badge-offline');
    setNodeBadge('nodeWifiStatus', devStatus.data_link || 'Inactive', 'badge-disconnected');
    setNodeBadge('nodeCloudStatus', devStatus.thingspeak || 'Not Updating', 'badge-not-updating');
  }
}

function setBadge(el, className, text) {
  if (!el) return;
  el.className = `status-value-badge ${className}`;
  el.innerHTML = `<span class="dot"></span><span class="txt">${text}</span>`;
}

function setNodeBadge(id, text, className) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerText = text;
  el.className = `node-badge ${className}`;
}

function updateLiveTabMetrics(metrics) {
  // Live values
  document.getElementById('liveVoltage').innerText = formatVal(metrics.voltage, 1);
  document.getElementById('liveCurrent').innerText = formatVal(metrics.current, 2);
  document.getElementById('livePower').innerText = formatVal(metrics.power, 1);
  document.getElementById('liveEnergy').innerText = formatVal(metrics.energy, 2);

  // Min / Max tracking
  if (metrics.voltage !== null && metrics.voltage !== undefined) {
    AppState.minMax.voltage.min = Math.min(AppState.minMax.voltage.min, metrics.voltage);
    AppState.minMax.voltage.max = Math.max(AppState.minMax.voltage.max, metrics.voltage);
    document.getElementById('minVoltage').innerText = `${AppState.minMax.voltage.min} V`;
    document.getElementById('maxVoltage').innerText = `${AppState.minMax.voltage.max} V`;
    const vPercent = Math.min(100, Math.max(0, ((metrics.voltage - 180) / (260 - 180)) * 100));
    document.getElementById('barVoltage').style.width = `${vPercent}%`;
  }

  if (metrics.current !== null && metrics.current !== undefined) {
    AppState.minMax.current.min = Math.min(AppState.minMax.current.min, metrics.current);
    AppState.minMax.current.max = Math.max(AppState.minMax.current.max, metrics.current);
    document.getElementById('minCurrent').innerText = `${AppState.minMax.current.min} A`;
    document.getElementById('maxCurrent').innerText = `${AppState.minMax.current.max} A`;
    const iPercent = Math.min(100, Math.max(0, (metrics.current / 20) * 100));
    document.getElementById('barCurrent').style.width = `${iPercent}%`;
  }

  if (metrics.power !== null && metrics.power !== undefined) {
    AppState.minMax.power.min = Math.min(AppState.minMax.power.min, metrics.power);
    AppState.minMax.power.max = Math.max(AppState.minMax.power.max, metrics.power);
    document.getElementById('minPower').innerText = `${AppState.minMax.power.min} W`;
    document.getElementById('maxPower').innerText = `${AppState.minMax.power.max} W`;
    const pPercent = Math.min(100, Math.max(0, (metrics.power / 4000) * 100));
    document.getElementById('barPower').style.width = `${pPercent}%`;
  }
}

// ==============================================================================
// TNEB Electricity Bill Calculation (matching ESP32 firmware)
// ==============================================================================
function calculateTNEBBill(units) {
  if (units === null || units === undefined || isNaN(units)) return 0.0;
  const u = Math.max(0, parseFloat(units));

  if (u <= 200) {
    return 0.0;
  } else if (u <= 400) {
    return (u - 200.0) * 4.70;
  } else if (u <= 500) {
    return (200.0 * 4.70) + ((u - 400.0) * 6.30);
  } else {
    return (300.0 * 4.70) + (100.0 * 6.30) + ((u - 500.0) * 8.40);
  }
}

function getTNEBBreakdown(units) {
  const u = (units === null || units === undefined || isNaN(units)) ? 0 : Math.max(0, parseFloat(units));
  let activeSlab = 1;
  let s1_u = 0, s1_c = 0;
  let s2_u = 0, s2_c = 0;
  let s3_u = 0, s3_c = 0;
  let s4_u = 0, s4_c = 0;

  if (u <= 200) {
    activeSlab = 1;
    s1_u = u;
    s1_c = 0.0;
  } else if (u <= 400) {
    activeSlab = 2;
    s1_u = 200.0;
    s1_c = 0.0;
    s2_u = u - 200.0;
    s2_c = s2_u * 4.70;
  } else if (u <= 500) {
    activeSlab = 3;
    s1_u = 200.0;
    s1_c = 0.0;
    s2_u = 200.0;
    s2_c = 200.0 * 4.70;
    s3_u = u - 400.0;
    s3_c = s3_u * 6.30;
  } else {
    activeSlab = 4;
    s1_u = 0.0;
    s2_u = 300.0;
    s2_c = 300.0 * 4.70;
    s3_u = 100.0;
    s3_c = 100.0 * 6.30;
    s4_u = u - 500.0;
    s4_c = s4_u * 8.40;
  }

  const total = s1_c + s2_c + s3_c + s4_c;
  return {
    active_slab: activeSlab,
    total_bill: total,
    slabs: [
      { slab: "Slab 1 (0 - 200 Units)", rate: "FREE (₹0.00)", units: s1_u, cost: s1_c, is_active: activeSlab === 1 },
      { slab: "Slab 2 (201 - 400 Units)", rate: "₹4.70 / Unit", units: s2_u, cost: s2_c, is_active: activeSlab === 2 },
      { slab: "Slab 3 (401 - 500 Units)", rate: "₹6.30 / Unit", units: s3_u, cost: s3_c, is_active: activeSlab === 3 },
      { slab: "Slab 4 (Above 500 Units)", rate: "₹8.40 / Unit", units: s4_u, cost: s4_c, is_active: activeSlab === 4 }
    ]
  };
}

function updateBillingTab(metrics) {
  const energy = metrics.energy !== null && metrics.energy !== undefined ? Number(metrics.energy) : 0;
  const tneb = metrics.tneb_breakdown || getTNEBBreakdown(energy);
  
  // Directly display Bill Amount from ThingSpeak Field 7
  const currentBill = metrics.bill_amount !== null && metrics.bill_amount !== undefined ? metrics.bill_amount : (metrics.field7_bill !== null && metrics.field7_bill !== undefined ? metrics.field7_bill : null);
  
  document.getElementById('billCurrentAmount').innerText = formatVal(currentBill, 2);
  document.getElementById('billEnergyTotal').innerText = formatVal(metrics.energy, 2);
  document.getElementById('breakdownEnergy').innerText = `${formatVal(metrics.energy, 2)} kWh`;
  document.getElementById('breakdownField7').innerText = currentBill !== null ? `₹ ${formatVal(currentBill, 2)}` : 'Waiting for Field 7 data';
  document.getElementById('breakdownCalculated').innerText = currentBill !== null ? `₹ ${formatVal(currentBill, 2)}` : `₹ ${formatVal(tneb.total_bill, 2)}`;
  document.getElementById('billSourceDesc').innerText = 'Source: ThingSpeak Field 7 (ESP32 Firmware)';

  // Update TNEB Slab Table
  const activeSlab = tneb.active_slab || 1;
  const badgeEl = document.getElementById('activeSlabBadge');
  if (badgeEl) {
    badgeEl.innerText = `Slab ${activeSlab} Active`;
  }

  const s1 = tneb.slabs ? tneb.slabs[0] : { units: Math.min(energy, 200), cost: 0, is_active: activeSlab === 1 };
  const s2 = tneb.slabs ? tneb.slabs[1] : { units: 0, cost: 0, is_active: activeSlab === 2 };
  const s3 = tneb.slabs ? tneb.slabs[2] : { units: 0, cost: 0, is_active: activeSlab === 3 };
  const s4 = tneb.slabs ? tneb.slabs[3] : { units: 0, cost: 0, is_active: activeSlab === 4 };

  const s1Units = document.getElementById('tnebSlab1Units');
  const s1Cost = document.getElementById('tnebSlab1Cost');
  const s1Status = document.getElementById('tnebSlab1Status');
  const row1 = document.getElementById('tnebRow1');
  if (s1Units) s1Units.innerText = `${formatVal(s1.units, 2)} U`;
  if (s1Cost) s1Cost.innerText = `₹ ${formatVal(s1.cost, 2)}`;
  if (s1Status) {
    s1Status.innerText = s1.is_active ? 'Active' : (energy > 200 ? 'Completed' : 'Inactive');
    s1Status.className = s1.is_active ? 'slab-tier-pill active' : 'slab-tier-pill';
  }
  if (row1) row1.className = s1.is_active ? 'slab-active' : '';

  const s2Units = document.getElementById('tnebSlab2Units');
  const s2Cost = document.getElementById('tnebSlab2Cost');
  const s2Status = document.getElementById('tnebSlab2Status');
  const row2 = document.getElementById('tnebRow2');
  if (s2Units) s2Units.innerText = `${formatVal(s2.units, 2)} U`;
  if (s2Cost) s2Cost.innerText = `₹ ${formatVal(s2.cost, 2)}`;
  if (s2Status) {
    s2Status.innerText = s2.is_active ? 'Active' : (energy > 400 ? 'Completed' : 'Inactive');
    s2Status.className = s2.is_active ? 'slab-tier-pill active' : 'slab-tier-pill';
  }
  if (row2) row2.className = s2.is_active ? 'slab-active' : '';

  const s3Units = document.getElementById('tnebSlab3Units');
  const s3Cost = document.getElementById('tnebSlab3Cost');
  const s3Status = document.getElementById('tnebSlab3Status');
  const row3 = document.getElementById('tnebRow3');
  if (s3Units) s3Units.innerText = `${formatVal(s3.units, 2)} U`;
  if (s3Cost) s3Cost.innerText = `₹ ${formatVal(s3.cost, 2)}`;
  if (s3Status) {
    s3Status.innerText = s3.is_active ? 'Active' : (energy > 500 ? 'Completed' : 'Inactive');
    s3Status.className = s3.is_active ? 'slab-tier-pill active' : 'slab-tier-pill';
  }
  if (row3) row3.className = s3.is_active ? 'slab-active' : '';

  const s4Units = document.getElementById('tnebSlab4Units');
  const s4Cost = document.getElementById('tnebSlab4Cost');
  const s4Status = document.getElementById('tnebSlab4Status');
  const row4 = document.getElementById('tnebRow4');
  if (s4Units) s4Units.innerText = `${formatVal(s4.units, 2)} U`;
  if (s4Cost) s4Cost.innerText = `₹ ${formatVal(s4.cost, 2)}`;
  if (s4Status) {
    s4Status.innerText = s4.is_active ? 'Active' : 'Inactive';
    s4Status.className = s4.is_active ? 'slab-tier-pill active' : 'slab-tier-pill';
  }
  if (row4) row4.className = s4.is_active ? 'slab-active' : '';

  const totalCalcEl = document.getElementById('tnebTotalCalculated');
  if (totalCalcEl) totalCalcEl.innerText = currentBill !== null ? `₹ ${formatVal(currentBill, 2)}` : `₹ ${formatVal(tneb.total_bill, 2)}`;

  // Estimated daily & monthly projections from Field 7 bill
  if (currentBill !== null && currentBill > 0) {
    const estMonthlyBill = currentBill * 1.2;
    const estDailyBill = estMonthlyBill / 30;
    document.getElementById('billEstDaily').innerText = estDailyBill.toFixed(2);
    document.getElementById('billEstMonthly').innerText = estMonthlyBill.toFixed(2);
  } else {
    document.getElementById('billEstDaily').innerText = '0.00';
    document.getElementById('billEstMonthly').innerText = '0.00';
  }
}

// ==============================================================================
// ESP32 OLED 128x64 Hardware Mirror Controller (matching SSD1306 code)
// ==============================================================================
function setupOled() {
  const btnAuto = document.getElementById('oledModeAuto');
  const btnS1 = document.getElementById('oledModeS1');
  const btnS2 = document.getElementById('oledModeS2');

  function setOledMode(mode) {
    AppState.oled.mode = mode;
    [btnAuto, btnS1, btnS2].forEach(b => b && b.classList.remove('active'));

    if (mode === 'auto') {
      if (btnAuto) btnAuto.classList.add('active');
    } else if (mode === 's1') {
      if (btnS1) btnS1.classList.add('active');
      AppState.oled.activeScreen = 0;
      renderOledScreen();
    } else if (mode === 's2') {
      if (btnS2) btnS2.classList.add('active');
      AppState.oled.activeScreen = 1;
      renderOledScreen();
    }
  }

  if (btnAuto) btnAuto.addEventListener('click', () => setOledMode('auto'));
  if (btnS1) btnS1.addEventListener('click', () => setOledMode('s1'));
  if (btnS2) btnS2.addEventListener('click', () => setOledMode('s2'));

  // Start 3-second auto-rotate timer matching ESP32 firmware (OLED_INTERVAL = 3000)
  if (AppState.oled.timer) clearInterval(AppState.oled.timer);
  AppState.oled.timer = setInterval(() => {
    if (AppState.oled.mode === 'auto') {
      AppState.oled.activeScreen = AppState.oled.activeScreen === 0 ? 1 : 0;
      renderOledScreen();
    }
  }, 3000);
}

function updateOledDisplay(metrics) {
  AppState.oled.lastMetrics = metrics;
  renderOledScreen();
}

function renderOledScreen() {
  const m = AppState.oled.lastMetrics || {};
  const s1El = document.getElementById('oledDisplayS1');
  const s2El = document.getElementById('oledDisplayS2');
  const indEl = document.getElementById('oledActiveScreenIndicator');

  // Screen 1: POWER MONITOR
  const vEl = document.getElementById('oledV');
  const iEl = document.getElementById('oledI');
  const pEl = document.getElementById('oledP');
  const eEl = document.getElementById('oledE');

  if (vEl) vEl.innerText = (m.voltage !== null && m.voltage !== undefined && !isNaN(m.voltage)) ? `${Number(m.voltage).toFixed(1)} V` : 'ERROR';
  if (iEl) iEl.innerText = (m.current !== null && m.current !== undefined && !isNaN(m.current)) ? `${Number(m.current).toFixed(2)} A` : 'ERROR';
  if (pEl) pEl.innerText = (m.power !== null && m.power !== undefined && !isNaN(m.power)) ? `${Number(m.power).toFixed(1)} W` : 'ERROR';
  if (eEl) eEl.innerText = (m.energy !== null && m.energy !== undefined && !isNaN(m.energy)) ? `${Number(m.energy).toFixed(2)} kWh` : 'ERROR';

  // Screen 2: BILL INFORMATION
  const uEl = document.getElementById('oledUnits');
  const bEl = document.getElementById('oledBill');

  if (uEl) uEl.innerText = (m.energy !== null && m.energy !== undefined && !isNaN(m.energy)) ? `${Number(m.energy).toFixed(2)} U` : 'ERROR';
  
  const billVal = (m.bill_amount !== null && m.bill_amount !== undefined) ? m.bill_amount : (m.energy !== null ? calculateTNEBBill(m.energy) : null);
  if (bEl) bEl.innerText = (billVal !== null && !isNaN(billVal)) ? Number(billVal).toFixed(2) : 'ERROR';

  // Toggle visible display
  if (AppState.oled.activeScreen === 0) {
    if (s1El) s1El.style.display = 'flex';
    if (s2El) s2El.style.display = 'none';
    if (indEl) indEl.innerText = 'Screen 1: Power Monitor';
  } else {
    if (s1El) s1El.style.display = 'none';
    if (s2El) s2El.style.display = 'flex';
    if (indEl) indEl.innerText = 'Screen 2: Bill Info';
  }
}

function updateDiagnosticsTab(data) {
  const devStatus = data.device_status || {};
  document.getElementById('diagChannelId').innerText = safeGet(AppState.settings.channel_id, 'Not Set');
  document.getElementById('diagEntryId').innerText = safeGet(data.entry_id, '--');
  document.getElementById('diagLastTimestamp').innerText = safeGet(data.last_update ? formatToIST(data.last_update, 'full') : data.last_update_full, '--');
  document.getElementById('diagFeedAge').innerText = devStatus.age_seconds !== null ? `${devStatus.age_seconds} seconds` : '--';
  document.getElementById('diagTimeout').innerText = `${AppState.settings.data_timeout} seconds`;

  const healthEl = document.getElementById('diagConnectionHealth');
  if (devStatus.is_online) {
    healthEl.className = 'text-green';
    healthEl.innerText = 'Active (Healthy)';
  } else {
    healthEl.className = 'text-orange';
    healthEl.innerText = 'Inactive / No Feed';
  }
}

function updateQuickInsights(insights) {
  // Usage
  const usageTag = document.getElementById('insightUsageTag');
  const usageDesc = document.getElementById('insightUsageDesc');
  usageTag.innerText = insights.usage_status || 'Normal';
  usageTag.className = `insight-tag tag-${insights.usage_badge === 'warning' ? 'high' : 'normal'}`;
  usageDesc.innerText = insights.usage_desc || 'Nominal power load draw.';

  // Efficiency
  const effTag = document.getElementById('insightEffTag');
  const effDesc = document.getElementById('insightEffDesc');
  effTag.innerText = insights.efficiency || 'Good';
  effTag.className = `insight-tag tag-${insights.efficiency_badge === 'danger' ? 'low' : insights.efficiency_badge === 'warning' ? 'moderate' : 'good'}`;
  effDesc.innerText = insights.efficiency_desc || 'Evaluated from system telemetry.';

  // Trend
  const trendTag = document.getElementById('insightTrendTag');
  const trendDesc = document.getElementById('insightTrendDesc');
  trendTag.innerText = insights.trend || 'Stable';
  trendTag.className = `insight-tag tag-${insights.trend_direction === 'up' ? 'high' : 'stable'}`;
  trendDesc.innerText = insights.trend_direction === 'up' ? 'Load demand is increasing over recent cycles.' : insights.trend_direction === 'down' ? 'Load demand is decreasing.' : 'Steady power draw across recent readings.';
}

function renderDashboardAlerts(alerts) {
  const container = document.getElementById('dashboardAlertsContainer');
  if (!container) return;

  if (!alerts || alerts.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = alerts.map(alert => `
    <div class="alert-banner ${alert.type || 'info'}">
      <i data-lucide="${alert.type === 'danger' ? 'alert-triangle' : alert.type === 'warning' ? 'alert-circle' : 'info'}"></i>
      <div>
        <strong>${alert.title}:</strong> ${alert.message}
      </div>
    </div>
  `).join('');

  if (window.lucide) window.lucide.createIcons();
}

function renderErrorState(errMsg) {
  const topbarBadge = document.getElementById('topbarStatusBadge');
  const topbarText = document.getElementById('topbarStatusText');
  topbarBadge.className = 'status-pill status-offline';
  topbarText.innerText = 'Connection Error';

  renderDashboardAlerts([{
    type: 'danger',
    title: 'Unable to fetch latest data',
    message: 'Could not communicate with the backend proxy or ThingSpeak API. Check your connection or channel settings.'
  }]);
}

// ==============================================================================
// Data Fetching: Historical Feeds & Charts Rendering
// ==============================================================================
async function fetchHistoryData(results = 20) {
  try {
    const response = await fetch(`/api/energy/history?results=${results}`);
    if (!response.ok) return;

    const data = await response.json();
    const feeds = data.feeds || [];

    // Update charts with feeds
    updateCharts(feeds);

    // Update Live Packets Table
    updateLiveFeedsTable(feeds.slice(-10).reverse());

    // Update Analytics Stats
    updateAnalyticsSummary(feeds);
  } catch (error) {
    console.warn('History fetch error:', error);
  }
}

function updateLiveFeedsTable(recentFeeds) {
  const tbody = document.getElementById('liveFeedsTableBody');
  if (!tbody) return;

  if (!recentFeeds || recentFeeds.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4">No historical feed packets available yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = recentFeeds.map(f => `
    <tr>
      <td>#${safeGet(f.entry_id, '--')}</td>
      <td>${formatToIST(f.created_at, 'chart')}</td>
      <td>${formatVal(f.voltage, 1)}</td>
      <td>${formatVal(f.current, 2)}</td>
      <td>${formatVal(f.power, 1)}</td>
      <td>${formatVal(f.energy, 2)}</td>
      <td>₹ ${formatVal(f.bill_amount, 2)}</td>
    </tr>
  `).join('');
}

function updateAnalyticsSummary(feeds) {
  if (!feeds || feeds.length === 0) return;

  const powers = feeds.map(f => f.power).filter(v => v !== null && !isNaN(v));
  const voltages = feeds.map(f => f.voltage).filter(v => v !== null && !isNaN(v));
  const energies = feeds.map(f => f.energy).filter(v => v !== null && !isNaN(v));

  if (powers.length > 0) {
    const peak = Math.max(...powers);
    document.getElementById('statPeakPower').innerText = `${peak.toFixed(1)} W`;
  }
  if (voltages.length > 0) {
    const avgV = voltages.reduce((a, b) => a + b, 0) / voltages.length;
    document.getElementById('statAvgVoltage').innerText = `${avgV.toFixed(1)} V`;
  }
  if (energies.length > 0) {
    const maxE = Math.max(...energies);
    document.getElementById('statTotalEnergy').innerText = `${maxE.toFixed(2)} kWh`;
  }
}

// ==============================================================================
// Chart.js Visualizations
// ==============================================================================
function initCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0f172a',
        titleFont: { family: 'Plus Jakarta Sans', size: 12, weight: 'bold' },
        bodyFont: { family: 'JetBrains Mono', size: 12 },
        padding: 10,
        cornerRadius: 8,
        callbacks: {
          title: function(tooltipItems) {
            if (!tooltipItems || !tooltipItems.length) return '';
            return tooltipItems[0].label || '';
          }
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { family: 'Plus Jakarta Sans', size: 11 }, color: '#94a3b8' }
      },
      y: {
        grid: { color: '#f1f5f9' },
        ticks: { font: { family: 'JetBrains Mono', size: 11 }, color: '#94a3b8' }
      }
    }
  };

  // 1. Live Data Trend Chart (Dashboard)
  const trendCtx = document.getElementById('liveTrendChart');
  if (trendCtx) {
    AppState.charts.liveTrend = new Chart(trendCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Voltage (V)',
            data: [],
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.08)',
            borderWidth: 2,
            tension: 0.3,
            yAxisID: 'y1'
          },
          {
            label: 'Current (A)',
            data: [],
            borderColor: '#8b5cf6',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [4, 4],
            tension: 0.3,
            yAxisID: 'y2'
          },
          {
            label: 'Power (W)',
            data: [],
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            fill: true,
            borderWidth: 2.5,
            tension: 0.3,
            yAxisID: 'y'
          }
        ]
      },
      options: {
        ...commonOptions,
        scales: {
          x: commonOptions.scales.x,
          y: {
            position: 'left',
            grid: { color: '#f1f5f9' },
            title: { display: true, text: 'Power (W)', font: { size: 11, weight: 'bold' }, color: '#f59e0b' },
            ticks: { font: { family: 'JetBrains Mono', size: 11 }, color: '#94a3b8' }
          },
          y1: {
            position: 'right',
            grid: { display: false },
            title: { display: true, text: 'Voltage (V)', font: { size: 11, weight: 'bold' }, color: '#3b82f6' },
            ticks: { font: { family: 'JetBrains Mono', size: 11 }, color: '#94a3b8' }
          },
          y2: {
            position: 'right',
            display: false,
            grid: { display: false }
          }
        }
      }
    });
  }

  // 2. Energy Consumption Chart (Dashboard)
  const energyCtx = document.getElementById('energyConsumptionChart');
  if (energyCtx) {
    AppState.charts.energy = new Chart(energyCtx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: 'Energy (kWh)',
          data: [],
          backgroundColor: 'rgba(16, 185, 129, 0.85)',
          hoverBackgroundColor: '#10b981',
          borderRadius: 6
        }]
      },
      options: commonOptions
    });
  }

  // 3. Live Stream Chart (Live Tab)
  const streamCtx = document.getElementById('liveStreamChart');
  if (streamCtx) {
    AppState.charts.liveStream = new Chart(streamCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Power (W)',
            data: [],
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            fill: true,
            borderWidth: 2,
            tension: 0.4
          },
          {
            label: 'Current (A)',
            data: [],
            borderColor: '#8b5cf6',
            borderWidth: 2,
            tension: 0.4,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        ...commonOptions,
        scales: {
          x: commonOptions.scales.x,
          y: {
            position: 'left',
            title: { display: true, text: 'Power (W)', color: '#f59e0b' }
          },
          y1: {
            position: 'right',
            grid: { display: false },
            title: { display: true, text: 'Current (A)', color: '#8b5cf6' }
          }
        }
      }
    });
  }

  // 4. Analytics Individual Charts
  initAnalyticsChart('chartAnalyticsPower', 'Power (W)', '#f59e0b', 'line');
  initAnalyticsChart('chartAnalyticsEnergy', 'Energy (kWh)', '#10b981', 'bar');
  initAnalyticsChart('chartAnalyticsVoltage', 'Voltage (V)', '#3b82f6', 'line');
  initAnalyticsChart('chartAnalyticsCurrent', 'Current (A)', '#8b5cf6', 'line');
}

function initAnalyticsChart(canvasId, label, color, type) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  AppState.charts[canvasId] = new Chart(ctx, {
    type: type,
    data: {
      labels: [],
      datasets: [{
        label: label,
        data: [],
        borderColor: color,
        backgroundColor: type === 'bar' ? color : `${color}20`,
        fill: type === 'line',
        borderWidth: 2,
        tension: 0.3,
        borderRadius: type === 'bar' ? 6 : 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          titleFont: { family: 'Plus Jakarta Sans', size: 11 },
          bodyFont: { family: 'JetBrains Mono', size: 11 },
          callbacks: {
            title: function(tooltipItems) {
              if (!tooltipItems || !tooltipItems.length) return '';
              return tooltipItems[0].label || '';
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Plus Jakarta Sans', size: 10 }, color: '#94a3b8' }
        },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: '#94a3b8' }
        }
      }
    }
  });
}

function updateCharts(feeds) {
  if (!feeds || feeds.length === 0) return;

  // Exact UTC to Asia/Kolkata (IST) conversion for all charts
  const labels = feeds.map(f => formatToIST(f.created_at, 'chart'));
  const voltages = feeds.map(f => f.voltage);
  const currents = feeds.map(f => f.current);
  const powers = feeds.map(f => f.power);
  const energies = feeds.map(f => f.energy);

  // 1. Update Live Data Trend Chart (Dashboard)
  if (AppState.charts.liveTrend) {
    AppState.charts.liveTrend.data.labels = labels;
    AppState.charts.liveTrend.data.datasets[0].data = voltages;
    AppState.charts.liveTrend.data.datasets[1].data = currents;
    AppState.charts.liveTrend.data.datasets[2].data = powers;
    AppState.charts.liveTrend.update('none');
  }

  // 2. Update Energy Consumption Chart (Dashboard)
  if (AppState.charts.energy) {
    AppState.charts.energy.data.labels = labels;
    AppState.charts.energy.data.datasets[0].data = energies;
    AppState.charts.energy.update('none');
  }

  // 3. Update Live Stream Chart (Live Tab)
  if (AppState.charts.liveStream) {
    AppState.charts.liveStream.data.labels = labels;
    AppState.charts.liveStream.data.datasets[0].data = powers;
    AppState.charts.liveStream.data.datasets[1].data = currents;
    AppState.charts.liveStream.update('none');
  }

  // 4. Update Analytics Individual Charts
  updateSingleAnalyticsChart('chartAnalyticsPower', labels, powers);
  updateSingleAnalyticsChart('chartAnalyticsEnergy', labels, energies);
  updateSingleAnalyticsChart('chartAnalyticsVoltage', labels, voltages);
  updateSingleAnalyticsChart('chartAnalyticsCurrent', labels, currents);
}

function updateSingleAnalyticsChart(chartKey, labels, data) {
  if (AppState.charts[chartKey]) {
    AppState.charts[chartKey].data.labels = labels;
    AppState.charts[chartKey].data.datasets[0].data = data;
    AppState.charts[chartKey].update('none');
  }
}

// ==============================================================================
// Settings & Configuration Management
// ==============================================================================
async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return;

    const data = await response.json();
    AppState.settings = data;

    // Populate Settings UI
    document.getElementById('settingChannelId').value = data.channel_id || '';
    document.getElementById('settingReadApiKey').value = data.read_api_key || '';
    document.getElementById('settingRefreshInterval').value = data.refresh_interval || 15;
    document.getElementById('settingDataTimeout').value = data.data_timeout || 60;

    // Update polling rate display in Live tab
    const rateEl = document.getElementById('livePollRate');
    if (rateEl) rateEl.innerText = `${data.refresh_interval || 15}s`;

    AppState.pollingIntervalMs = (data.refresh_interval || 15) * 1000;
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

function setupSettingsForm() {
  const form = document.getElementById('settingsForm');
  const toggleKeyBtn = document.getElementById('toggleApiKeyBtn');
  const keyInput = document.getElementById('settingReadApiKey');
  const testBtn = document.getElementById('btnTestConnection');
  const feedbackEl = document.getElementById('settingsFeedback');

  // Toggle API Key visibility
  if (toggleKeyBtn && keyInput) {
    toggleKeyBtn.addEventListener('click', () => {
      const isPassword = keyInput.type === 'password';
      keyInput.type = isPassword ? 'text' : 'password';
      const icon = document.getElementById('toggleApiKeyIcon');
      if (icon) {
        icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
        if (window.lucide) window.lucide.createIcons();
      }
    });
  }

  // Save Settings
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const payload = {
        channel_id: document.getElementById('settingChannelId').value.trim(),
        read_api_key: document.getElementById('settingReadApiKey').value.trim(),
        refresh_interval: parseInt(document.getElementById('settingRefreshInterval').value, 10),
        data_timeout: parseInt(document.getElementById('settingDataTimeout').value, 10)
      };

      try {
        const response = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const resData = await response.json();
        if (resData.success) {
          showFeedback('Settings saved successfully! Updating live feed...', 'success');
          await loadSettings();
          startPolling();
          fetchLatestData();
          fetchHistoryData();
        } else {
          showFeedback(`Failed to save settings: ${resData.error || 'Unknown error'}`, 'error');
        }
      } catch (err) {
        showFeedback(`Network error saving settings: ${err.message}`, 'error');
      }
    });
  }

  // Test Connection
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      showFeedback('Pinging ThingSpeak Cloud API...', 'success');
      try {
        const response = await fetch('/api/energy/latest');
        const data = await response.json();

        if (data.status === 'success') {
          showFeedback(`✓ Connection Successful! Connected to "${data.channel_info?.name || 'Channel'}". Latest Feed: ${data.last_update_formatted}`, 'success');
        } else if (data.status === 'empty') {
          showFeedback('✓ Connected to Channel, but channel contains 0 feeds yet. Start ESP32 to upload data.', 'success');
        } else if (data.status === 'unconfigured') {
          showFeedback('Please enter both Channel ID and Read API Key and click "Save Settings".', 'error');
        } else {
          showFeedback(`✗ Connection Failed: ${data.message || 'Check credentials'}`, 'error');
        }
      } catch (err) {
        showFeedback(`✗ Test request failed: ${err.message}`, 'error');
      }
    });
  }

  function showFeedback(msg, type) {
    if (!feedbackEl) return;
    feedbackEl.style.display = 'block';
    feedbackEl.className = `settings-feedback ${type}`;
    feedbackEl.innerText = msg;
    setTimeout(() => {
      if (type === 'success') {
        feedbackEl.style.display = 'none';
      }
    }, 6000);
  }
}
