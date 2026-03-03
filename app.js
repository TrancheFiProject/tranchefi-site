// TrancheFi Dashboard — Live API Version
// Colors: Senior = blue (#4a8eff), Junior = gold (#d4a843)

var DIVIDENDS = [
  { from: '2025-08-01', div: 0.800 },
  { from: '2025-09-01', div: 0.842 },
  { from: '2025-10-01', div: 0.867 },
  { from: '2025-11-01', div: 0.892 },
  { from: '2025-12-01', div: 0.917 },
  { from: '2026-01-01', div: 0.925 },
  { from: '2026-02-01', div: 0.938 },
  { from: '2026-03-01', div: 0.938 }
];

function getDividend(date) {
  var d = 0.938;
  for (var i = 0; i < DIVIDENDS.length; i++) {
    if (date >= DIVIDENDS[i].from) d = DIVIDENDS[i].div;
  }
  return d;
}

var V = { sr:0.70, jr:0.30, syBps:800, smBps:50, jmBps:100, pfBps:2000, satFee:0.10, ltv:0.75 };

function levFromVol(v) {
  if (v < 8) return 2.00;
  if (v < 12) return 1.85;
  if (v < 16) return 1.75;
  if (v < 20) return 1.50;
  return 1.50;
}
function volLabel(v) {
  if (v < 8) return 'Low';
  if (v < 12) return 'Low-Med';
  if (v < 16) return 'Medium';
  if (v < 20) return 'Med-High';
  return 'High';
}

function computeVol(closes, endIdx, win) {
  var start = Math.max(0, endIdx - win);
  if (endIdx - start < 5) return 14.7;
  var rets = [];
  for (var i = start + 1; i <= endIdx; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  var mean = rets.reduce(function(s, r) { return s + r; }, 0) / rets.length;
  var vari = rets.reduce(function(s, r) { return s + (r - mean) * (r - mean); }, 0) / (rets.length - 1);
  return Math.sqrt(vari) * Math.sqrt(252) * 100;
}

function buildWeeklyData(api) {
  var weeks = api.weeks || [];
  var daily = api.daily || [];
  var borrow = api.current.borrowRate;
  var dateIdx = {};
  var closes = [];
  for (var i = 0; i < daily.length; i++) {
    dateIdx[daily[i].date] = i;
    closes.push(daily[i].close);
  }
  var result = [];
  for (var w = 0; w < weeks.length; w++) {
    var wk = weeks[w];
    var idx = dateIdx[wk.date];
    var vol = (idx !== undefined && closes.length > 5) ? computeVol(closes, idx, 30) : api.current.vol30d;
    result.push({
      date: wk.date, strc: wk.strc, btc: api.current.btc,
      dividend: getDividend(wk.date), borrowRate: borrow,
      vol30d: Math.round(vol * 10) / 10
    });
  }
  return result;
}

function compute(data) {
  var weeks = [], sNAV = 10000, jNAV = 10000, bNAV = 10000;
  var sPk = 10000, jPk = 10000, sDD = 0, jDD = 0, sNeg = 0, jNeg = 0, jRets = [];
  for (var i = 0; i < data.length; i++) {
    var d = data[i], lev = levFromVol(d.vol30d);
    var sY = (d.dividend * 12 / 100) * (1 - V.satFee);
    var bR = d.borrowRate / 100;
    var pY = lev * sY - (lev - 1) * bR;
    var hf = (V.ltv * lev) / (lev - 1);
    if (i === 0) {
      weeks.push({ date:d.date, strc:d.strc, vol30d:d.vol30d, week:0, lev:lev, pY:pY*100, hf:hf, sR:0, jR:0, sC:0, jC:0, bC:0, sNAV:sNAV, jNAV:jNAV, bNAV:bNAV });
      continue;
    }
    var p = data[i-1], wY = pY/52, mkt = (d.strc - p.strc) / p.strc;
    var poolChg = wY + mkt * lev;
    var sCoup = (V.syBps/10000)/52, sFee = (V.smBps/10000)/52, jFee = (V.jmBps/10000)/52;
    var jRes = (poolChg - sCoup*V.sr - sFee*V.sr - jFee*V.jr) / V.jr;
    var jH = (V.syBps/10000)/52;
    if (jRes > jH) jRes = jRes - (jRes - jH) * (V.pfBps/10000);
    var sRet = sCoup - sFee;
    sNAV *= (1 + sRet); jNAV = Math.max(0, jNAV * (1 + jRes));
    bNAV *= (1 + sY/52 + mkt);
    sPk = Math.max(sPk, sNAV); jPk = Math.max(jPk, jNAV);
    sDD = Math.min(sDD, (sNAV-sPk)/sPk); jDD = Math.min(jDD, (jNAV-jPk)/jPk);
    if (sRet < 0) sNeg++; if (jRes < 0) jNeg++; jRets.push(jRes);
    weeks.push({ date:d.date, strc:d.strc, vol30d:d.vol30d, week:i, lev:lev, pY:pY*100, hf:hf, sR:sRet*100, jR:jRes*100, sC:((sNAV/10000)-1)*100, jC:((jNAV/10000)-1)*100, bC:((bNAV/10000)-1)*100, sNAV:sNAV, jNAV:jNAV, bNAV:bNAV });
  }
  var n = weeks.length - 1;
  var sAnn = n > 0 ? (Math.pow(sNAV/10000, 52/n) - 1) * 100 : 0;
  var jAnn = n > 0 ? (Math.pow(Math.max(jNAV,0.01)/10000, 52/n) - 1) * 100 : 0;
  var dR = jRets.filter(function(r){return r<0;});
  var dV = dR.length > 0 ? dR.reduce(function(s,r){return s+r*r;},0)/dR.length : 0;
  var dDev = Math.sqrt(dV) * Math.sqrt(52);
  var jSort = dDev > 0 ? (jAnn/100)/dDev : 0;
  return { weeks:weeks, sAnn:sAnn, jAnn:jAnn, sDD:sDD*100, jDD:jDD*100, sNeg:sNeg, jNeg:jNeg, jSort:jSort, sNAV:sNAV, jNAV:jNAV, bNAV:bNAV };
}

function fmt(v, plus) { return (v > 0 && plus ? '+' : '') + v.toFixed(3) + '%'; }
function comma(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function renderDash(weeklyData, api) {
  try {
    var p = compute(weeklyData);
    var w = p.weeks;
    var L = w[w.length - 1];
    var n = w.length - 1;

    var lv = api.current.vol30d;
    var ll = levFromVol(lv);
    var ld = getDividend(new Date().toISOString().split('T')[0]);
    var ls = (ld * 12 / 100) * (1 - V.satFee);
    var lb = api.current.borrowRate / 100;
    var lp = ll * ls - (ll - 1) * lb;
    var lh = (V.ltv * ll) / (ll - 1);

    document.getElementById('sc-strc').textContent = '$' + api.current.strc.toFixed(2);
    document.getElementById('sc-vol').textContent = lv.toFixed(1) + '%';
    document.getElementById('sc-vol-regime').textContent = 'Regime: ' + volLabel(lv);
    document.getElementById('sc-lev').textContent = ll.toFixed(2) + '\u00d7';
    document.getElementById('sc-pool').textContent = (lp * 100).toFixed(1) + '%';

    var hfEl = document.getElementById('sc-hf');
    hfEl.textContent = lh.toFixed(2);
    hfEl.className = 'sc-value ' + (lh > 1.5 ? 'green' : lh > 1.3 ? '' : 'red');
    document.getElementById('sc-hf-status').textContent = lh > 1.5 ? 'Healthy' : lh > 1.3 ? 'Watch' : 'Warning';
    document.getElementById('dash-epoch').textContent = n === 0 ? 'Inception' : 'Week ' + n;

    if (api.current.timestamp) {
      var dt = new Date(api.current.timestamp);
      document.getElementById('dash-subtitle').textContent = 'Live data \u00b7 ' + dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    }

    document.getElementById('sr-cumul').textContent = fmt(L.sC, true);
    document.getElementById('sr-week').textContent = n > 0 ? fmt(L.sR, true) : '--';
    document.getElementById('sr-ann').textContent = n >= 4 ? p.sAnn.toFixed(2) + '%' : '--';
    document.getElementById('sr-10k').textContent = '$' + comma(L.sNAV.toFixed(0));
    document.getElementById('sr-neg').textContent = String(p.sNeg);
    document.getElementById('sr-dd').textContent = p.sDD.toFixed(2) + '%';
    document.getElementById('sr-sharpe').textContent = n >= 4 ? '\u221e' : '--';

    document.getElementById('jr-cumul').textContent = fmt(L.jC, true);
    document.getElementById('jr-week').textContent = n > 0 ? fmt(L.jR, true) : '--';
    document.getElementById('jr-ann').textContent = n >= 4 ? p.jAnn.toFixed(2) + '%' : '--';
    document.getElementById('jr-10k').textContent = '$' + comma(Math.max(L.jNAV, 0).toFixed(0));
    document.getElementById('jr-neg').textContent = String(p.jNeg);
    document.getElementById('jr-dd').textContent = p.jDD.toFixed(2) + '%';
    document.getElementById('jr-sortino').textContent = p.jSort > 0 ? p.jSort.toFixed(2) : '--';

    renderChart(w);
    renderHistory(w);
  } catch (err) {
    console.error('Render error:', err);
    document.getElementById('dash-subtitle').textContent = 'Render error: ' + err.message;
  }
}

function renderChart(w) {
  var ctx = document.getElementById('perfChart');
  if (!ctx) return;
  if (window._tfC) { try { window._tfC.destroy(); } catch(e){} }
  window._tfC = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels: w.map(function(x) { return x.week === 0 ? 'Start' : 'W' + x.week; }),
      datasets: [
        { label:'Senior', data:w.map(function(x){return x.sC;}), borderColor:'#4a8eff', backgroundColor:'rgba(74,142,255,0.05)', borderWidth:2.5, pointRadius:w.length<20?4:2, pointBackgroundColor:'#4a8eff', fill:true, tension:0.3 },
        { label:'Junior', data:w.map(function(x){return x.jC;}), borderColor:'#d4a843', backgroundColor:'rgba(212,168,67,0.05)', borderWidth:2.5, pointRadius:w.length<20?4:2, pointBackgroundColor:'#d4a843', fill:true, tension:0.3 },
        { label:'sUSDat 1x', data:w.map(function(x){return x.bC;}), borderColor:'#3d4362', borderWidth:1.5, borderDash:[6,4], pointRadius:0, fill:false, tension:0.3 }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{intersect:false,mode:'index'},
      plugins:{ legend:{display:false}, tooltip:{ backgroundColor:'#171d32', titleColor:'#e2e4ef', bodyColor:'#a8adc0', borderColor:'rgba(255,255,255,0.1)', borderWidth:1, padding:12, callbacks:{ label:function(c){ return c.dataset.label+': '+(c.parsed.y>0?'+':'')+c.parsed.y.toFixed(3)+'%'; }}}},
      scales:{
        x:{grid:{color:'rgba(255,255,255,0.03)'},ticks:{color:'#3d4362',font:{family:'Space Mono',size:10}}},
        y:{grid:{color:'rgba(255,255,255,0.03)'},ticks:{color:'#3d4362',font:{family:'Space Mono',size:10},callback:function(v){return(v>0?'+':'')+v.toFixed(2)+'%';}}}
      }
    }
  });
}

function renderHistory(w) {
  var tbody = document.getElementById('history-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  for (var i = w.length - 1; i >= 0; i--) {
    var x = w[i], b = x.week === 0, tr = document.createElement('tr');
    tr.innerHTML = '<td>'+(b?'Start':'Week '+x.week)+'<br><span style="font-size:10px;color:#3d4362">'+x.date+'</span></td><td>$'+x.strc.toFixed(2)+'</td><td>'+x.vol30d.toFixed(1)+'%</td><td>'+x.lev.toFixed(2)+'\u00d7</td><td>'+x.pY.toFixed(1)+'%</td><td class="'+(x.sR>0?'positive':x.sR<0?'negative':'')+'">'+(b?'--':fmt(x.sR,true))+'</td><td class="'+(x.jR>0?'positive':x.jR<0?'negative':'')+'">'+(b?'--':fmt(x.jR,true))+'</td><td>'+x.hf.toFixed(2)+'</td>';
    tbody.appendChild(tr);
  }
}

function switchPage(id) {
  var p = document.querySelectorAll('.page'), t = document.querySelectorAll('.nav-tab');
  for (var i = 0; i < p.length; i++) p[i].classList.remove('active');
  for (var i = 0; i < t.length; i++) t[i].classList.remove('active');
  var pg = document.getElementById('page-' + id);
  if (pg) pg.classList.add('active');
  var at = document.querySelectorAll('.nav-tab[data-page]');
  for (var i = 0; i < at.length; i++) { if (at[i].getAttribute('data-page') === id) at[i].classList.add('active'); }
  window.scrollTo(0, 0);
}
var tb = document.querySelectorAll('.nav-tab[data-page]');
for (var i = 0; i < tb.length; i++) {
  tb[i].addEventListener('click', (function(t) { return function() { switchPage(t.getAttribute('data-page')); }; })(tb[i]));
}

// INIT
(function() {
  var ids = ['sc-strc','sc-vol','sc-lev','sc-pool','sc-hf'];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el) el.textContent = '...';
  }
  var sub = document.getElementById('dash-subtitle');
  if (sub) sub.textContent = 'Loading live data...';

  fetch('/api/market-data')
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(api) {
      console.log('API response:', api);
      var wd = buildWeeklyData(api);
      if (wd.length === 0) {
        wd = [{ date:'2026-03-03', strc:api.current.strc, btc:api.current.btc, dividend:0.938, borrowRate:api.current.borrowRate, vol30d:api.current.vol30d }];
      }
      renderDash(wd, api);
    })
    .catch(function(err) {
      console.error('Fetch error:', err);
      var sub = document.getElementById('dash-subtitle');
      if (sub) sub.textContent = 'Error: ' + err.message + ' — using fallback';
      var fb = { current:{ strc:99.96, btc:84500, borrowRate:5.5, vol30d:14.7, timestamp:new Date().toISOString() }, daily:[], weeks:[{date:'2026-03-03',strc:99.96}] };
      var wd = [{ date:'2026-03-03', strc:99.96, btc:84500, dividend:0.938, borrowRate:5.5, vol30d:14.7 }];
      renderDash(wd, fb);
    });
})();
