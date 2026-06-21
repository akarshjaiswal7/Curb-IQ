/* ================================================================
   CurbIQ  —  Operator Mode JS
   Requires app.js globals: $, fmt, fmt1, ramp, DATA,
   ACCENT, ACCENT2, HOT, WARN, GOOD, UNIT_COLORS, COLOR_STOPS
   ================================================================ */

/* ---- state ---- */
var opMap, opHexLayer, opJunctionLayer, opBlindLayer,
    opPatrolLayer, opEmergenceLayer, opWeeklyLayer;
var emergencyActive = false;
var currentViewMode = 'enforcement';
var opWeekTimer    = null;
var enrichedJunctions = [];
var lastFilteredRoutes = null;   // tracks the plan currently shown on map

/* ================================================================
   Utilities
   ================================================================ */
function riskCategory(score) {
  if (score >= 90) return { label:'Critical', color:'#ff3b30', cls:'risk-critical' };
  if (score >= 70) return { label:'High',     color:'#fb923c', cls:'risk-high' };
  if (score >= 40) return { label:'Medium',   color:'#fbbf24', cls:'risk-medium' };
  return                   { label:'Low',      color:'#34d399', cls:'risk-low' };
}
function cleanJunctionName(n) { return n.replace(/^BTP\d+\s*-\s*/, ''); }

function findNearestCell(lat, lon) {
  var best = null, bd = Infinity;
  for (var i = 0; i < DATA.cells.length; i++) {
    var c = DATA.cells[i],
        d = (c.lat - lat) * (c.lat - lat) + (c.lon - lon) * (c.lon - lon);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function findNearestJunction(lat, lon) {
  var best = null, bd = Infinity;
  for (var i = 0; i < DATA.junctions.length; i++) {
    var j = DATA.junctions[i],
        d = (j.lat - lat) * (j.lat - lat) + (j.lon - lon) * (j.lon - lon);
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}

function getPeakRiskWindow() {
  try {
    // Prefer the pre-computed timing artifact (accurate, from build_all.py)
    var tm = DATA.timing && DATA.timing.summary;
    if (tm && tm.peak_hour != null) {
      var s = tm.peak_hour;
      return { start: s, end: s + 4 };
    }
    // Fallback: compute from fairness temporal gap
    var gaps  = DATA.fairness.temporal.under_enforcement_gap;
    var hours = DATA.fairness.temporal.hour;
    var maxS = -Infinity, bs = 17;
    for (var i = 0; i <= hours.length - 4; i++) {
      var s2 = gaps[i] + gaps[i+1] + gaps[i+2] + gaps[i+3];
      if (s2 > maxS) { maxS = s2; bs = hours[i]; }
    }
    return { start: bs, end: bs + 4 };
  } catch (e) { return { start: 17, end: 21 }; }
}

function impactLabel(priority_score) {
  // Use the same score-based buckets as riskCategory for consistency
  if (priority_score == null) return { t:'Unknown', cls:'' };
  if (priority_score >= 70) return { t:'High',   cls:'risk-high' };
  if (priority_score >= 40) return { t:'Medium', cls:'risk-medium' };
  return                     { t:'Low',    cls:'risk-low' };
}

/* ================================================================
   Init
   ================================================================ */
function initOperatorMode() {
  /* enrich junctions with nearest cell data */
  enrichedJunctions = DATA.junctions.map(function(j) {
    var c = findNearestCell(j.lat, j.lon);
    return Object.assign({}, j, {
      name: cleanJunctionName(j.junction_id),
      cell: c,
      risk: riskCategory(c ? c.priority_score : 0),
      window_start: c ? c.window_start : null,
      window_end:   c ? c.window_end   : null,
      priority_score: c ? c.priority_score : 0,
      recoverable_delay: c ? c.recoverable_delay : null
    });
  }).sort(function(a, b) {
    if (b.priority_score !== a.priority_score) {
      return b.priority_score - a.priority_score;
    }
    return b.count - a.count;
  });

  buildOpMap();
  renderOpKPIs();
  renderTargetCards();
  seedDispatchForm();   // <-- seed inputs from DATA.patrol before first render
  renderDispatchPlan();
  wireOpControls();
  setupOpTimeline();
  setViewMode('enforcement');
}

/* ================================================================
   Map
   ================================================================ */
function buildOpMap() {
  opMap = L.map('op-map', {
    zoomControl: false, preferCanvas: true, attributionControl: false
  }).setView([12.9716, 77.5946], 12);

  L.control.zoom({ position: 'bottomright' }).addTo(opMap);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 19
  }).addTo(opMap);

  opHexLayer       = L.layerGroup().addTo(opMap);
  opJunctionLayer  = L.layerGroup();
  opBlindLayer     = L.layerGroup();
  opPatrolLayer    = L.layerGroup();
  opEmergenceLayer = L.layerGroup();
  opWeeklyLayer    = L.layerGroup();
}

/* ================================================================
   Operational KPIs
   ================================================================ */
function renderOpKPIs() {
  var critCnt = DATA.cells.filter(function(c){ return c.priority_score >= 90; }).length;
  var topJ    = enrichedJunctions[0];
  var peak    = getPeakRiskWindow();
  var cRed    = DATA.scenario.summary.cells_for_50pct;

  /* Also derive patrol units from DATA.patrol n_units (the KPI box) */
  var n_units = DATA.patrol ? DATA.patrol.n_units : 0;

  var items = [
    { icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg>', value: critCnt,                     label:'Critical Zones' },
    { icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>', value: n_units+' Recommended', label:'Patrol Units' },
    { icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>', value: topJ ? topJ.name : '\u2014', label:'Top Deploy Target' },
    { icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',       value: pad2(peak.start)+':00\u2013'+pad2(peak.end)+':00', label:'Peak Risk Window' },
    { icon:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="2" width="10" height="20" rx="3"></rect><circle cx="12" cy="7" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="17" r="1.5"></circle></svg>', value: cRed+' cells \u2192 50%',    label:'Congestion Reduction' }
  ];

  $('op-kpis').innerHTML = items.map(function(k) {
    return '<div class="op-kpi">'
      + '<span class="op-kpi-icon">'+k.icon+'</span>'
      + '<div class="op-kpi-body">'
      +   '<div class="op-kpi-value">'+k.value+'</div>'
      +   '<div class="op-kpi-label">'+k.label+'</div>'
      + '</div></div>';
  }).join('');
}
function pad2(n) { return String(n).padStart(2,'0'); }

/* ================================================================
   Deployment-target cards
   ================================================================ */
function renderTargetCards(limit) {
  var list = enrichedJunctions.slice(0, limit || 10);

  $('op-targets').innerHTML = list.map(function(j, i) {
    var imp = impactLabel(j.priority_score);   // use priority_score, consistent with riskCategory
    var win = j.window_start != null
      ? pad2(j.window_start)+':00\u2013'+pad2(j.window_end)+':00' : '\u2014';

    return '<div class="op-target-card" data-idx="'+i+'">'
      + '<div class="op-target-rank">Rank #'+(i+1)+'</div>'
      + '<div class="op-target-name">'+j.name+'</div>'
      + '<span class="op-risk-badge '+j.risk.cls+'">'+j.risk.label+'</span>'
      + '<div class="op-target-stats">'
      +   '<div class="op-target-stat"><span class="op-target-stat-label">Violations</span>'
      +     '<span class="op-target-stat-value">'+fmt(j.count)+'</span></div>'
      +   '<div class="op-target-stat"><span class="op-target-stat-label">Window</span>'
      +     '<span class="op-target-stat-value">'+win+'</span></div>'
      +   '<div class="op-target-stat"><span class="op-target-stat-label">Impact</span>'
      +     '<span class="op-target-stat-value"><span class="op-risk-badge '+imp.cls+'" style="font-size:9px">'+imp.t+'</span></span></div>'
      + '</div>'
      + '<button class="op-target-btn" onclick="viewOnOpMap('+j.lat+','+j.lon+','+i+')">View On Map</button>'
      + '</div>';
  }).join('');
}

function viewOnOpMap(lat, lon, idx) {
  opMap.setView([lat, lon], 15, { animate: true });
  var j = enrichedJunctions[idx], c = j.cell;
  L.popup().setLatLng([lat, lon])
    .setContent(c ? opCellPopup(c) : '<b>'+j.name+'</b><br>'+fmt(j.count)+' violations')
    .openOn(opMap);
}

/* ================================================================
   Hex rendering (operator map)
   ================================================================ */
var VIEW_MODES = {
  enforcement: { metric:'priority_score', layers:['junctions','blind'],  label:'Enforcement Priority' },
  congestion:  { metric:'cis_score',      layers:[],                     label:'Congestion Impact (CIS)' },
  forecast:    { metric:'forecast_area',  layers:['emergence'],          label:'Forecast (Next Day)' },
  patrol:      { metric:'priority_score', layers:['patrol'],             label:'Patrol Planning' }
};

function setViewMode(mode) {
  currentViewMode = mode;
  var cfg = VIEW_MODES[mode];

  /* highlight active radio */
  document.querySelectorAll('.op-view-mode').forEach(function(el) {
    var r = el.querySelector('input[type="radio"]');
    el.classList.toggle('active', r && r.value === mode);
  });

  var lt = $('op-legend-title');
  if (lt) lt.textContent = cfg.label;

  /* If timeline is active, re-render the week with the new metric instead of resetting */
  if (opMap.hasLayer(opWeeklyLayer)) {
    opRenderWeek(+$('op-week-slider').value);
    // Still update overlays (junctions, blind spots etc) regardless of timeline
    [opJunctionLayer, opBlindLayer, opPatrolLayer, opEmergenceLayer].forEach(function(l) {
      l.clearLayers();
      if (opMap.hasLayer(l)) opMap.removeLayer(l);
    });
    if (cfg.layers.indexOf('junctions')  >= 0) opRenderJunctions();
    if (cfg.layers.indexOf('blind')      >= 0) opRenderBlind();
    if (cfg.layers.indexOf('patrol')     >= 0) opRenderPatrol();
    if (cfg.layers.indexOf('emergence')  >= 0) opRenderEmergence();
  } else {
    /* Ensure the hex layer is on the map */
    if (!opMap.hasLayer(opHexLayer)) {
      opHexLayer.addTo(opMap);
    }
    opRenderHexes(cfg.metric);
    /* clear optional overlays */
    [opJunctionLayer, opBlindLayer, opPatrolLayer, opEmergenceLayer].forEach(function(l) {
      l.clearLayers();
      if (opMap.hasLayer(l)) opMap.removeLayer(l);
    });
    if (cfg.layers.indexOf('junctions')  >= 0) opRenderJunctions();
    if (cfg.layers.indexOf('blind')      >= 0) opRenderBlind();
    if (cfg.layers.indexOf('patrol')     >= 0) opRenderPatrol();
    if (cfg.layers.indexOf('emergence')  >= 0) opRenderEmergence();
  }
}

function opRenderHexes(metric) {
  if (!opMap.hasLayer(opHexLayer)) {
    opHexLayer.addTo(opMap);
  }
  opHexLayer.clearLayers();
  var cells = DATA.cells.filter(function(c){ return c[metric] != null; });

  if (emergencyActive)
    cells = cells.sort(function(a,b){ return b.priority_score - a.priority_score; }).slice(0, 10);

  if (!cells.length) return;

  var vals = cells.map(function(c){ return +c[metric]; });
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if (metric === 'gi_z') lo = Math.max(lo, -3);

  var el_lo = $('op-legmin'), el_hi = $('op-legmax');
  if (el_lo) el_lo.textContent = isFinite(lo) ? fmt1(lo) : 'Low';
  if (el_hi) el_hi.textContent = isFinite(hi) ? fmt1(hi) : 'High';

  var span = hi - lo || 1;
  cells.forEach(function(c) {
    var t    = (+c[metric] - lo) / span;
    var ring = h3.cellToBoundary(c.h3);
    var poly = L.polygon(ring, {
      fillColor: ramp(t), color: c.is_hotspot ? '#ffffff' : ramp(t),
      weight: c.is_hotspot ? 1.1 : 0.3,
      fillOpacity: 0.62, opacity: c.is_hotspot ? 0.9 : 0.4
    });
    poly.bindPopup(opCellPopup(c));
    opHexLayer.addLayer(poly);
  });
}

/* ---- overlay helpers ---- */
function opRenderJunctions() {
  opJunctionLayer.clearLayers();
  DATA.junctions.forEach(function(j) {
    var r = 4 + Math.sqrt(j.count) / 12;
    L.circleMarker([j.lat, j.lon], {
      radius: r, color: ACCENT2, weight: 1.5, fillColor: ACCENT2, fillOpacity: 0.4
    }).bindPopup('<b>'+cleanJunctionName(j.junction_id)+'</b>'
      + '<div class="popup-row"><span>Violations</span><span>'+fmt(j.count)+'</span></div>'
      + '<div class="popup-row"><span>Peak share</span><span>'+(j.peak_share*100).toFixed(0)+'%</span></div>')
      .addTo(opJunctionLayer);
  });
  opJunctionLayer.addTo(opMap);
}

function opRenderBlind() {
  opBlindLayer.clearLayers();
  DATA.priority.blind_spots.forEach(function(b) {
    L.circleMarker([b.lat, b.lon], { radius: 7, color: WARN, weight: 2, fillOpacity: 0.15 })
      .bindPopup('<b>Under-enforced area</b>'
        + '<div class="popup-row"><span>Gap</span><span>'+fmt1(b.under_enforcement_gap)+'</span></div>'
        + '<div class="popup-row"><span>Violations</span><span>'+fmt(b.count)+'</span></div>')
      .addTo(opBlindLayer);
  });
  opBlindLayer.addTo(opMap);
}

/*
 * opRenderPatrol(routes)
 *   routes : optional array of filtered route objects from buildFilteredRoutes().
 *            Falls back to lastFilteredRoutes, then all pre-computed routes.
 */
function opRenderPatrol(routes) {
  opPatrolLayer.clearLayers();
  var dep    = DATA.patrol.depot;
  var source = routes || lastFilteredRoutes || DATA.patrol.routes;

  L.circleMarker([dep.lat, dep.lon], {
    radius: 7, color:'#fff', weight: 2, fillColor:'#0b0e14', fillOpacity: 0.95
  }).bindPopup('<b>Patrol depot</b><div class="popup-row"><span>Shift start</span>'
    + '<span>'+(DATA.patrol.shift_start||'17:30')+'</span></div>').addTo(opPatrolLayer);

  source.forEach(function(rt, i) {
    if (!rt.stops.length) return;   // standby unit — no line drawn
    var col = UNIT_COLORS[i % UNIT_COLORS.length];
    var pts = [[dep.lat, dep.lon]].concat(
      rt.stops.map(function(s){ return [s.lat, s.lon]; }),
      [[dep.lat, dep.lon]]
    );
    L.polyline(pts, { color: col, weight: 3, opacity: 0.85, dashArray:'4 6' }).addTo(opPatrolLayer);
    rt.stops.forEach(function(s) {
      L.circleMarker([s.lat, s.lon], {
        radius: 5, color: col, weight: 2, fillColor: col, fillOpacity: 0.7
      }).bindPopup('<b>'+rt.unit+'</b> \u00B7 stop '+s.seq
        + '<div class="popup-row"><span>ETA</span><span>'+s.eta+'</span></div>'
        + '<div class="popup-row"><span>Priority</span><span>'+fmt1(s.priority)+'</span></div>')
        .addTo(opPatrolLayer);
    });
  });
  opPatrolLayer.addTo(opMap);
}

function opRenderEmergence() {
  opEmergenceLayer.clearLayers();
  var cells = (DATA.emergence && DATA.emergence.cells) || [];
  var bc = { high: HOT, elevated: WARN, low: ACCENT };
  cells.forEach(function(e) {
    var col = bc[e.risk_band] || ACCENT;
    L.circleMarker([e.lat, e.lon], {
      radius: 6, color: col, weight: 2, fillColor: col, fillOpacity: 0.25
    }).bindPopup('<b>Emergence watch</b> '
      + '<span class="op-risk-badge '+(e.risk_band==='high'?'risk-critical':'risk-medium')+'">'+e.risk_band+'</span>'
      + '<div class="popup-row"><span>Risk</span><span>'+fmt1(e.emergence_risk*100)+'%</span></div>')
      .addTo(opEmergenceLayer);
  });
  opEmergenceLayer.addTo(opMap);
}

/* ================================================================
   "Why This Location?" popup  +  Impact simulation
   ================================================================ */
function opCellPopup(c) {
  var risk = riskCategory(c.priority_score);

  /* plain-language reasons */
  var reasons = [];
  if (c.is_hotspot)                    reasons.push('\u2713 High violation density');
  if (c.cis_score > 50)               reasons.push('\u2713 Significant congestion impact');
  if (c.forecast_area > 50)           reasons.push('\u2713 Forecast hotspot (next day)');
  if (c.is_blind_spot)                reasons.push('\u2713 Currently under-enforced');
  if (c.predicted_emerging)           reasons.push('\u2713 Emerging hotspot risk');
  var nearJ = DATA.junctions.some(function(j) {
    return Math.sqrt((j.lat-c.lat)*(j.lat-c.lat)+(j.lon-c.lon)*(j.lon-c.lon)) < 0.01;
  });
  if (nearJ) reasons.push('\u2713 Near major junction');

  var h = '<div class="op-popup">';

  /* header */
  h += '<div class="op-popup-header">';
  h += '<span class="op-risk-badge '+risk.cls+'">'+risk.label+'</span>';
  if (c.zone_id) h += ' <span class="op-popup-zone">'+c.zone_id+'</span>';
  h += '</div>';

  /* stats */
  h += '<div class="op-popup-stats">';
  h += _pstat(fmt(c.count), 'Violations');
  if (c.window_start != null)
    h += _pstat(pad2(c.window_start)+':00\u2013'+pad2(c.window_end)+':00', 'Best Window');
  h += _pstat('#'+c.priority_rank, 'Priority Rank');
  h += _pstat(c.top_offence || '\u2014', 'Top Offence');
  h += '</div>';

  /* why */
  if (reasons.length) {
    h += '<div class="op-popup-reasons"><div class="op-popup-reasons-title">Why selected?</div>';
    h += reasons.map(function(r){ return '<div class="op-popup-reason">'+r+'</div>'; }).join('');
    h += '</div>';
  }

  /* impact sim */
  h += '<div class="op-popup-impact"><div class="op-popup-impact-title">What if we enforce here?</div>';
  h += '<div class="op-popup-stats">';
  h += _pstat(fmt(c.count), 'Violations Affected');
  if (c.extra_delay_pct != null)
    h += _pstat(fmt1(c.extra_delay_pct)+'%', 'Congestion Reduction');
  if (c.recoverable_pct != null)
    h += _pstat(fmt1(c.recoverable_pct*100)+'%', 'Coverage Gain');
  h += '</div></div>';

  h += '</div>';
  return h;
}
function _pstat(v, l) {
  return '<div class="op-popup-stat"><span class="op-popup-stat-v">'+v+'</span>'
       + '<span class="op-popup-stat-l">'+l+'</span></div>';
}

/* ================================================================
   Dispatch planner
   ================================================================ */

/* Parse "HH:MM" ETA string → minutes since midnight */
function etaToMins(eta) {
  if (!eta) return Infinity;
  var p = eta.split(':');
  return +p[0] * 60 + +p[1];
}

/*
 * Build routes filtered by:
 *  - nUnits  : first N pre-computed routes (capped at max available)
 *  - shiftH  : shift duration in hours; stops whose ETA falls after
 *              shift_start + shiftH are dropped from each route.
 *              If a route has 0 reachable stops after filtering it is
 *              still shown as a card ("0 stops in window") so officers
 *              know the unit is on standby.
 */
function buildFilteredRoutes(nUnits, shiftH) {
  var maxRoutes = DATA.patrol.routes.length;
  var n         = Math.min(nUnits, maxRoutes);
  // patrol shift_start is "17:30"
  var startMins = etaToMins(DATA.patrol.shift_start || '17:30');
  var endMins   = startMins + shiftH * 60;

  return DATA.patrol.routes.slice(0, n).map(function(rt) {
    var filteredStops = rt.stops.filter(function(s) {
      return etaToMins(s.eta) <= endMins;
    });
    return Object.assign({}, rt, {
      stops:          filteredStops,
      filteredCount:  filteredStops.length,
      totalCount:     rt.stops.length
    });
  });
}

/* Seed the dispatch form inputs from DATA.patrol so they are never hardcoded */
function seedDispatchForm() {
  var unitsEl = $('op-units');
  var shiftEl = $('op-shift');
  if (!unitsEl || !shiftEl || !DATA.patrol) return;
  var n = DATA.patrol.n_units || 6;
  unitsEl.value = n;
  unitsEl.max   = Math.max(n * 2, 12);
  /* derive shift from shift_start: default to 4h if not derivable */
  shiftEl.value = 4;
}

function renderDispatchPlan() {
  var inputUnits = +$('op-units').value || DATA.patrol.n_units || 6;
  var shiftH     = +$('op-shift').value || 4;
  var maxRoutes  = DATA.patrol.routes.length;
  var el         = $('op-dispatch-results');

  // Warn clearly if user asked for more units than available
  var unitWarning = '';
  if (inputUnits > maxRoutes) {
    unitWarning = '<div class="op-dispatch-note">'
      + '⚠ Only ' + maxRoutes + ' patrol routes are pre-computed '
      + '(run <code>python build_all.py</code> to change). '
      + 'Showing all ' + maxRoutes + ' available routes.'
      + '</div>';
    inputUnits = maxRoutes;
  }

  var routes = buildFilteredRoutes(inputUnits, shiftH);
  lastFilteredRoutes = routes;   // keep for map sync

  if (!routes.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px">No routes available.</div>';
    return;
  }

  var shiftEnd = (function() {
    var p = (DATA.patrol.shift_start || '17:30').split(':');
    var endM = +p[0] * 60 + +p[1] + shiftH * 60;
    return pad2(Math.floor(endM / 60) % 24) + ':' + pad2(endM % 60);
  })();

  var html = routes.map(function(rt, i) {
    var col   = UNIT_COLORS[i % UNIT_COLORS.length];
    var top   = rt.stops[0];
    var nj    = top ? findNearestJunction(top.lat, top.lon) : null;
    var loc   = nj ? cleanJunctionName(nj.junction_id) : (top ? 'Grid sector' : 'Standby');
    var eta1  = top ? top.eta : '\u2014';
    var skipped = rt.totalCount - rt.filteredCount;

    var extra = '';
    if (skipped > 0) {
      extra = '<div style="font-size:10px;color:var(--warn);margin-top:4px">'
        + skipped + ' stop'+(skipped>1?'s':'')+' outside shift window</div>';
    }
    if (rt.filteredCount === 0) {
      loc = 'Standby (no stops in window)';
    }

    return '<div class="op-dispatch-card" style="border-left:3px solid '+col+'">'
      + '<div class="op-dispatch-unit">'+rt.unit+'</div>'
      + '<div class="op-dispatch-location">\u2192 '+loc+'</div>'
      + '<div class="op-dispatch-meta">'
      + '<span>'+rt.filteredCount+'/'+rt.totalCount+' stops</span>'
      + '<span>until '+shiftEnd+'</span>'
      + '<span>First ETA '+eta1+'</span>'
      + '</div>'
      + extra
      + '</div>';
  }).join('');

  el.innerHTML = html + unitWarning;
}

/* ================================================================
   Emergency mode
   ================================================================ */
function toggleEmergencyMode() {
  emergencyActive = !emergencyActive;
  $('op-emergency-btn').classList.toggle('active', emergencyActive);
  document.getElementById('operator-mode').classList.toggle('emergency', emergencyActive);

  if (emergencyActive) {
    renderTargetCards(10); // Show top 10 target cards (active enforcement windows)
    
    // Clear out extraneous layers
    [opJunctionLayer, opBlindLayer, opEmergenceLayer, opWeeklyLayer].forEach(function(l) {
      l.clearLayers();
      if (opMap.hasLayer(l)) opMap.removeLayer(l);
    });

    // explicitly render the two required layers
    opRenderHexes('priority_score');
    opRenderPatrol(lastFilteredRoutes || buildFilteredRoutes(6, 4));

    /* zoom to critical with a safe maxZoom so it doesn't get too close */
    var crit = DATA.cells
      .filter(function(c){ return c.priority_score >= 90; })
      .sort(function(a,b){ return b.priority_score - a.priority_score; })
      .slice(0, 10);
    if (crit.length) {
      opMap.fitBounds(L.latLngBounds(crit.map(function(c){ return [c.lat, c.lon]; })),
        { padding:[50,50], maxZoom: 14 });
    }
    
    /* force switch to target cards tab to show active windows */
    document.querySelectorAll('.op-action-tab').forEach(function(t){ t.classList.remove('active'); });
    document.querySelectorAll('.op-action-content').forEach(function(c){ c.style.display = 'none'; });
    var targetsTab = document.querySelector('.op-action-tab[data-optab="targets"]');
    if (targetsTab) targetsTab.classList.add('active');
    var targetsContent = $('op-tab-targets');
    if (targetsContent) targetsContent.style.display = '';
    
  } else {
    renderTargetCards(); // revert to default limit
    setViewMode(currentViewMode); // restores normal view modes
  }
}

/* ================================================================
   Timeline
   ================================================================ */
function setupOpTimeline() {
  var wk = DATA.weekly;
  if (!wk || !wk.weeks.length) return;
  var sl = $('op-week-slider');
  sl.max   = wk.weeks.length - 1;
  sl.value = wk.weeks.length - 1;
  sl.addEventListener('input', function(){ opRenderWeek(+sl.value); });

  $('op-tl-prev').addEventListener('click', function() {
    var v = Math.max(0, +sl.value - 1); sl.value = v; opRenderWeek(v);
  });
  $('op-tl-next').addEventListener('click', function() {
    var v = Math.min(+sl.max, +sl.value + 1); sl.value = v; opRenderWeek(v);
  });
  $('op-tl-play').addEventListener('click', toggleOpPlay);
  $('op-tl-all').addEventListener('click', opShowAllTime);
}

function opRenderWeek(idx) {
  var wk = DATA.weekly;
  if (opMap.hasLayer(opHexLayer)) opMap.removeLayer(opHexLayer);
  opWeeklyLayer.clearLayers();
  var maxc = wk.max_count || 1;
  
  var cfg = VIEW_MODES[currentViewMode] || VIEW_MODES['enforcement'];
  var metric = cfg.metric;
  
  var allCells = DATA.cells.filter(function(c){ return c[metric] != null; });
  var vals = allCells.map(function(c){ return +c[metric]; });
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if (metric === 'gi_z') lo = Math.max(lo, -3);
  var span = hi - lo || 1;

  wk.cells.forEach(function(c) {
    var v = c.counts[idx];
    if (!v) return;
    
    var t = Math.sqrt(v / maxc);
    var fullCell = CELL_MAP.get(c.h3);
    var popupExtra = "";

    if (fullCell && fullCell[metric] != null && metric !== "count") {
       t = (+fullCell[metric] - lo) / span;
       popupExtra = '<div class="popup-row"><span>' + cfg.label + '</span><span>' + fmt1(fullCell[metric]) + '</span></div>';
    }

    var col = ramp(t);
    var poly = L.polygon(h3.cellToBoundary(c.h3), { fillColor:col, color:col, weight:0.3, fillOpacity:0.7 })
      .bindPopup('<b>'+wk.weeks[idx]+'</b>'
        + '<div class="popup-row"><span>Violations</span><span>'+fmt(v)+'</span></div>' + popupExtra);
    opWeeklyLayer.addLayer(poly);
  });
  opWeeklyLayer.addTo(opMap);
  $('op-week-label').textContent = wk.weeks[idx];
}

function opShowAllTime() {
  opStopPlay();
  if (opMap.hasLayer(opWeeklyLayer)) opMap.removeLayer(opWeeklyLayer);
  opHexLayer.addTo(opMap);
  setViewMode(currentViewMode);
  $('op-week-label').textContent = 'All-time';
}

function toggleOpPlay() {
  if (opWeekTimer) { opStopPlay(); return; }
  $('op-tl-play').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
  var sl = $('op-week-slider');
  opWeekTimer = setInterval(function() {
    var v = (+sl.value + 1) % DATA.weekly.weeks.length;
    sl.value = v; opRenderWeek(v);
  }, 750);
}
function opStopPlay() {
  if (opWeekTimer) { clearInterval(opWeekTimer); opWeekTimer = null; }
  $('op-tl-play').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
}

/* ================================================================
   Controls wiring
   ================================================================ */
function wireOpControls() {
  /* view-mode radios */
  document.querySelectorAll('.op-view-mode input[type="radio"]').forEach(function(r) {
    r.addEventListener('change', function(){ setViewMode(r.value); });
  });

  /* emergency */
  $('op-emergency-btn').addEventListener('click', toggleEmergencyMode);

  /* dispatch — render cards first (sets lastFilteredRoutes), then sync map */
  $('op-generate-plan').addEventListener('click', function() {
    renderDispatchPlan();              // builds lastFilteredRoutes
    opPatrolLayer.clearLayers();
    opRenderPatrol(lastFilteredRoutes); // map shows exactly the same plan
    /* auto-switch to patrol view mode so routes are visible */
    if (currentViewMode !== 'patrol') setViewMode('patrol');
  });

  /* action-panel tabs */
  document.querySelectorAll('.op-action-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.op-action-tab').forEach(function(t){ t.classList.remove('active'); });
      document.querySelectorAll('.op-action-content').forEach(function(c){ c.style.display = 'none'; });
      tab.classList.add('active');
      $('op-tab-' + tab.dataset.optab).style.display = '';
      if (typeof positionOpIndicator === 'function') setTimeout(positionOpIndicator, 20);
    });
  });
}
