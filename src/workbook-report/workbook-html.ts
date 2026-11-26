import { serializeResult } from './workbook.compute';
import { WorkbookComputeResult, WorkbookOutcome } from './workbook-report.models';

export interface WorkbookRenderOptions {
  title?: string;
  initialTheme?: 'light' | 'dark';
  generatedAt?: Date;
}

/** Produces one self-contained HTML file: no external CSS, JS, fonts or images. */
export function renderWorkbookHtml(
  result: WorkbookComputeResult,
  opts: WorkbookRenderOptions = {},
): string {
  const title = opts.title ?? 'Trading Journal Workbook Report';
  const initialTheme = opts.initialTheme ?? 'light';
  return [
    '<!doctype html>',
    `<html lang="en" data-theme="${esc(initialTheme)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    style(),
    '</head>',
    '<body>',
    header(result, title),
    '<main class="wrap">',
    kpiSection(result),
    chartSection(result),
    calendarSection(),
    analysisSection(result),
    tradeTableSection(result),
    '</main>',
    script(result),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function header(result: WorkbookComputeResult, title: string): string {
  const first = result.firstTradeDate;
  const last = result.lastTradeDate;
  const range = !first || !last ? 'no trades yet' : `${dateLabel(first)} → ${dateLabel(last)}`;
  return `
<header class="topbar">
  <div class="topbar-inner">
    <div>
      <div class="eyebrow">TRADERLOG · WORKBOOK REPORT</div>
      <h1>${esc(title)}</h1>
      <p class="subtitle">${esc(result.settings.currency)} · ${esc(range)} · ${result.closedTrades} closed trades · contract size ${num(result.settings.contractSize, 2)}</p>
    </div>
    <div class="top-actions">
      <button id="themeBtn" class="ghost-btn" type="button">Theme</button>
      <button id="printBtn" class="ghost-btn" type="button">Print</button>
    </div>
  </div>
</header>`;
}

function kpiSection(r: WorkbookComputeResult): string {
  const c = r.settings.currency;
  const cards = [
    card(
      'ACCOUNT BALANCE',
      money(r.accountBalance, c),
      `Start ${money(r.settings.startCapital, c)} · cash flow ${signedMoney(r.totalCashFlow, c)}`,
      'teal',
    ),
    card(
      'NET PROFIT / LOSS',
      signedMoney(r.netPnl, c),
      `≈ ${signedMoney(r.netPnlUsd, 'USD')} USD`,
      'teal',
    ),
    card(
      'WIN RATE',
      pct(r.winRate),
      `${r.wins}W · ${r.losses}L · ${r.breakEvens} BE`,
      'teal',
    ),
    card(
      'PROFIT FACTOR',
      r.profitFactor == null ? 'n/a' : num(r.profitFactor, 2),
      `Gross +${num(r.grossProfit)} / −${num(r.grossLoss)}`,
      'teal',
    ),
    card(
      'EXPECTANCY PER TRADE',
      signedMoney(r.expectancy, c),
      `Avg win ${money(r.avgWin, c)} · avg loss ${money(r.avgLoss, c)}`,
      'navy',
    ),
    card(
      'MAX DRAWDOWN',
      money(r.maxDrawdown, c),
      `Peak equity ${money(r.peakEquity, c)}`,
      'red',
    ),
    card(
      'AVG RESULT RR',
      `${num(r.avgResultRr, 2)}R`,
      `Median planned ${num(r.medianPlannedRr, 2)}R`,
      'navy',
    ),
    card(
      'MONTHLY GOAL',
      pct(r.monthlyGoal),
      `${monthTitle(r.settings.calendarYear, r.settings.calendarMonth)}: ${signedMoney(r.monthPnl, c)} of ${num(r.settings.monthlyTarget)}`,
      'amber',
    ),
  ];
  return `<section class="kpi-grid">${cards.join('')}</section>`;
}

function card(label: string, value: string, sub: string, accent: string): string {
  return `
<article class="kpi ${accent}">
  <div class="kpi-label">${esc(label)}</div>
  <div class="kpi-value">${esc(value)}</div>
  <div class="kpi-sub">${esc(sub)}</div>
</article>`;
}

function chartSection(r: WorkbookComputeResult): string {
  return `
<section class="panel">
  <h2>Performance over time</h2>
  <div class="chart-grid">
    <div class="chart-box wide">
      <h3>Equity curve · start + trading P/L</h3>
      ${svgEquity(r.equityCurve)}
    </div>
    <div class="chart-box">
      <h3>Outcome mix</h3>
      ${svgDonut(r.wins, r.losses, r.breakEvens)}
    </div>
  </div>
  <h2 class="section-gap">Trade-by-trade &amp; timing</h2>
  <div class="chart-grid">
    <div class="chart-box wide">
      <h3>P/L of last 20 closed trades</h3>
      ${svgBars(
        r.last20Pnl,
        r.last20Pnl.map((_, i) => `#${r.closedTrades - r.last20Pnl.length + i + 1}`),
      )}
    </div>
    <div class="chart-box">
      <h3>Net P/L by weekday</h3>
      ${svgBars(
        r.weekdays.map((w) => w.netPnl),
        r.weekdays.map((w) => w.label),
      )}
    </div>
  </div>
</section>`;
}

function calendarSection(): string {
  return `
<section class="panel">
  <div class="panel-head">
    <div>
      <h2>P/L Calendar</h2>
      <p class="hint">Daily P/L, trade counts and discipline flags. Use the arrows to move between months.</p>
    </div>
    <div class="calendar-nav">
      <button id="prevMonth" class="ghost-btn" type="button">← Prev</button>
      <button id="nextMonth" class="ghost-btn" type="button">Next →</button>
    </div>
  </div>
  <div id="calendar" class="calendar"></div>
  <p class="legend">Green = profit · red = loss · dark red = daily loss limit breached · gold = today</p>
</section>`;
}

function analysisSection(r: WorkbookComputeResult): string {
  const monthRows = r.months
    .map((m) => {
      const hitClass = m.target === 'Hit' ? 'good' : m.target === 'Miss' ? 'bad' : '';
      return `
<tr>
  <td>${esc(m.label)}</td>
  <td>${m.trades}</td>
  <td>${m.winRate == null ? '—' : pct(m.winRate)}</td>
  <td class="${pnlClass(m.netPnl)}">${signedMoney(m.netPnl, r.settings.currency)}</td>
  <td>${pct(m.returnRatio)}</td>
  <td class="${hitClass}">${esc(m.target ?? '—')}</td>
</tr>`;
    })
    .join('');

  const strategyRows = r.strategies
    .map((s) => {
      const width = (s.winRate ?? 0) * 100;
      return `
<tr>
  <td>${esc(s.name)}</td>
  <td>${s.trades}</td>
  <td><div class="bar-cell"><span class="bar" style="width:${width.toFixed(1)}%"></span><b>${s.winRate == null ? '—' : pct(s.winRate)}</b></div></td>
  <td class="${pnlClass(s.netPnl)}">${signedMoney(s.netPnl, r.settings.currency)}</td>
  <td>${s.avgResultRr == null ? '—' : `${num(s.avgResultRr, 2)}R`}</td>
  <td>${s.profitFactor == null ? 'n/a' : num(s.profitFactor, 2)}</td>
</tr>`;
    })
    .join('');

  const disciplineRows: Array<[string, string, string]> = [
    ['Daily loss limit', money(r.settings.dailyLossLimit, r.settings.currency), ''],
    ['Days over loss limit', String(r.daysOverLossLimit), r.daysOverLossLimit > 0 ? 'bad' : 'good'],
    ['Max trades per day', String(r.settings.maxTradesPerDay), ''],
    ['Days over trade limit', String(r.daysOverTradeLimit), r.daysOverTradeLimit > 0 ? 'bad' : 'good'],
    ['Trading days', String(r.tradingDays), ''],
    ['Avg trades per day', num(r.avgTradesPerDay, 1), ''],
    ['Best day', signedMoney(r.bestDay, r.settings.currency), 'good'],
    ['Worst day', signedMoney(r.worstDay, r.settings.currency), 'bad'],
    ['Longest win streak', String(r.longestWinStreak), ''],
    ['Longest loss streak', String(r.longestLossStreak), ''],
    ['Current streak', r.currentStreak, ''],
  ];
  const discipline = disciplineRows
    .map(
      ([label, value, cls]) =>
        `<tr><td>${esc(label)}</td><td class="${cls}">${esc(value)}</td></tr>`,
    )
    .join('');

  return `
<section class="panel">
  <div class="panel-head">
    <div>
      <h2>Monthly performance · ${r.settings.dashboardYear}</h2>
      <p class="hint">Target: ${money(r.settings.monthlyTarget, r.settings.currency)} per month</p>
    </div>
    <div class="chart-box compact">${svgMonthBars(r.months)}</div>
  </div>
  <div class="table-scroll">
    <table class="data-table">
      <thead><tr><th>Month</th><th>Trades</th><th>Win rate</th><th>Net P/L</th><th>Return</th><th>Target</th></tr></thead>
      <tbody>${monthRows}</tbody>
    </table>
  </div>
  <div class="two-col">
    <div>
      <h2>Strategy playbook</h2>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Strategy</th><th>Trades</th><th>Win rate</th><th>Net P/L</th><th>Avg RR</th><th>PF</th></tr></thead>
          <tbody>${strategyRows}</tbody>
        </table>
      </div>
    </div>
    <div>
      <h2>Rules &amp; discipline</h2>
      <div class="table-scroll">
        <table class="data-table">
          <tbody>${discipline}</tbody>
        </table>
      </div>
    </div>
  </div>
</section>`;
}

function tradeTableSection(r: WorkbookComputeResult): string {
  const headers = [
    '#', 'Date', 'Day', 'Session', 'Symbol', 'Dir', 'Strategy', 'Lots',
    'Entry', 'SL', 'TP', 'Exit', 'Risk', 'RR', 'Move', 'P/L', 'RR', 'Outcome', 'Notes',
  ];
  const head = headers
    .map(
      (label, index) =>
        `<th data-sort="${index}">${esc(label)} <span class="sort-ind">↕</span></th>`,
    )
    .join('');

  const rowHtml = r.rows
    .map((row) => {
      const t = row.trade;
      const display: Array<string | null> = [
        String(row.number),
        dateLabel(t.date),
        row.day,
        t.session ?? null,
        t.symbol,
        t.direction,
        t.strategy ?? null,
        num(t.lots, 2),
        num(t.entry, 3),
        t.stopLoss == null ? null : num(t.stopLoss, 3),
        t.takeProfit == null ? null : num(t.takeProfit, 3),
        t.exit == null ? null : num(t.exit, 3),
        row.risk == null ? null : num(row.risk, 3),
        row.plannedRr == null ? null : `${num(row.plannedRr, 2)}R`,
        row.move == null ? null : num(row.move, 3),
        row.pnl == null ? null : signedMoney(row.pnl, r.settings.currency),
        row.resultRr == null ? null : `${num(row.resultRr, 2)}R`,
        outcomeLabel(row.outcome) || null,
        t.notes ?? null,
      ];
      const dataAttrs = display
        .map((value, index) => ` data-v${index}="${esc(value ?? '')}"`)
        .join('');
      const cells = display
        .map((raw, index) => {
          const value = raw ?? '—';
          let cls = '';
          if (index === 15 && row.pnl != null) cls = pnlClass(row.pnl);
          if (index === 17) {
            if (row.outcome === 'Win') cls = 'good';
            if (row.outcome === 'Loss') cls = 'bad';
            if (row.outcome === 'BE') cls = 'warn';
          }
          const thumbnail =
            index === 18 && t.screenshot && t.screenshot.trim()
              ? `<div class="shot">${esc(t.screenshot)}</div>`
              : '';
          return `<td class="${cls}">${esc(value)}${thumbnail}</td>`;
        })
        .join('');
      return `<tr${dataAttrs}>${cells}</tr>`;
    })
    .join('');

  return `
<section class="panel">
  <div class="panel-head">
    <div>
      <h2>Trade log</h2>
      <p class="hint">Search or click a column heading to sort. Green = win, red = loss, amber = break-even.</p>
    </div>
    <input id="tradeSearch" class="search" type="search" placeholder="Search trades…" aria-label="Search trades">
  </div>
  <div class="table-scroll tall">
    <table id="tradeTable" class="data-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${rowHtml}</tbody>
    </table>
  </div>
</section>`;
}

function style(): string {
  return String.raw`<style>
:root{
  --navy:#0B1F3A;--teal:#0E7C86;--light:#F3F5F9;--mid:#DDE4EE;
  --green:#1B7F4C;--red:#C0392B;--amber:#B7791F;--grey:#6B7280;
  --bg:#F7F8FB;--card:#FFFFFF;--text:#152033;--muted:#5E6B7A;--line:#D8DEE8;
}
html[data-theme="dark"]{
  --navy:#DCE8F7;--teal:#5FC7CE;--light:#18202E;--mid:#2A3547;
  --green:#63D69A;--red:#FF7B72;--amber:#F2C66D;--grey:#9AA7B8;
  --bg:#0D121B;--card:#151D29;--text:#E8EEF7;--muted:#A8B4C5;--line:#2C3748;
}
*{box-sizing:border-box}
body{margin:0;font-family:Arial,Helvetica,sans-serif;background:var(--bg);color:var(--text);font-size:14px}
.topbar{background:#0B1F3A;color:#fff;padding:18px 0 16px;border-bottom:4px solid #0E7C86}
.topbar-inner,.wrap{max-width:1320px;margin:0 auto;padding:0 18px}
.topbar-inner{display:flex;gap:16px;align-items:flex-start;justify-content:space-between}
.eyebrow{font-size:10px;letter-spacing:1.6px;color:#BFD4E6;font-weight:700}
h1{font-size:22px;margin:4px 0 4px;letter-spacing:-.3px}
.subtitle{margin:0;color:#BFD4E6;font-size:12px}
.top-actions{display:flex;gap:8px}
.ghost-btn{border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.08);color:inherit;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:12px;font-weight:700}
.ghost-btn:hover{background:rgba(255,255,255,.16)}
.wrap{padding-top:18px;padding-bottom:40px}
.kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.kpi{background:var(--card);border:1px solid var(--line);border-top:4px solid var(--teal);border-radius:12px;padding:14px 16px;min-height:118px;box-shadow:0 2px 10px rgba(11,31,58,.05)}
.kpi.navy{border-top-color:var(--navy)}.kpi.red{border-top-color:var(--red)}.kpi.amber{border-top-color:var(--amber)}
.kpi-label{font-size:10px;letter-spacing:1.1px;color:var(--grey);font-weight:700}
.kpi-value{font-size:23px;font-weight:700;color:var(--navy);margin:8px 0 6px;overflow-wrap:anywhere}
.kpi-sub{font-size:11px;color:var(--muted);line-height:1.35}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin-top:16px;box-shadow:0 2px 10px rgba(11,31,58,.05)}
.panel h2{font-size:14px;letter-spacing:.5px;margin:0 0 12px;color:var(--navy);text-transform:uppercase}
.panel h3{font-size:12px;color:var(--muted);margin:0 0 6px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
.section-gap{margin-top:20px !important}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:12px}
.hint{margin:4px 0 0;color:var(--muted);font-size:11px}
.chart-grid{display:grid;grid-template-columns:2fr 1fr;gap:14px}
.chart-box{border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--light);min-width:0}
.chart-box.wide{grid-column:span 1}
.chart-box.compact{width:280px;max-width:100%;padding:4px}
svg{display:block;width:100%;height:auto}
.calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.cal-head{font-size:10px;font-weight:700;color:var(--muted);text-align:center;padding:4px 0;letter-spacing:.6px}
.cal-week{display:contents}
.cal-day{border:1px solid var(--line);border-radius:8px;padding:6px;min-height:62px;background:var(--light);display:flex;flex-direction:column;justify-content:space-between}
.cal-day.muted{opacity:.35}
.cal-day.good{background:#D6F0DF;color:#14532D;border-color:#9BD3AF}
.cal-day.bad{background:#F9D6D3;color:#7F1D1D;border-color:#E7AAA4}
.cal-day.limit{background:#7F1D1D;color:#fff;border-color:#7F1D1D}
.cal-day.today{outline:3px solid #FFE08A;outline-offset:-3px}
.cal-date{font-size:11px;font-weight:700}
.cal-pnl{font-size:13px;font-weight:700;text-align:right;overflow-wrap:anywhere}
.cal-count{font-size:9px;color:inherit;opacity:.75;text-align:right}
.week-total{border:1px solid var(--line);border-radius:8px;background:var(--light);padding:6px;min-height:62px;display:flex;flex-direction:column;justify-content:space-between}
.week-total .cal-pnl{font-size:12px}
.legend{font-size:10px;color:var(--muted);margin:10px 0 0}
.table-scroll{overflow:auto;border:1px solid var(--line);border-radius:10px}
.table-scroll.tall{max-height:560px}
.data-table{border-collapse:collapse;width:100%;font-size:11px;white-space:nowrap}
.data-table th,.data-table td{padding:7px 9px;border-bottom:1px solid var(--line);text-align:center}
.data-table th{background:var(--navy);color:#fff;position:sticky;top:0;z-index:1;font-size:10px;letter-spacing:.3px;cursor:pointer;user-select:none}
html[data-theme="dark"] .data-table th{color:#0B1F3A}
.data-table td:first-child,.data-table th:first-child{text-align:left}
.data-table tbody tr:nth-child(even){background:var(--light)}
.sort-ind{opacity:.45;font-size:9px}
.good{color:var(--green);font-weight:700}.bad{color:var(--red);font-weight:700}.warn{color:var(--amber);font-weight:700}
.search{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--card);color:var(--text);min-width:220px}
.two-col{display:grid;grid-template-columns:1.4fr 1fr;gap:18px;margin-top:22px}
.bar-cell{display:flex;align-items:center;gap:6px;min-width:100px}
.bar-cell .bar{height:8px;background:var(--teal);border-radius:6px;display:inline-block;min-width:1px}
.bar-cell b{font-size:10px}
.shot{font-size:9px;color:var(--muted);max-width:180px;overflow:hidden;text-overflow:ellipsis}
@media (max-width:900px){
  .kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .chart-grid,.two-col{grid-template-columns:1fr}
  .chart-box.compact{width:100%}
  .topbar-inner{flex-direction:column}
}
@media (max-width:560px){
  .kpi-grid{grid-template-columns:1fr}
  .calendar{gap:3px}
  .cal-day,.week-total{min-height:56px;padding:4px}
  .cal-pnl{font-size:10px}
  .wrap{padding-left:10px;padding-right:10px}
}
@media print{
  body{background:#fff;color:#000}
  .top-actions,.calendar-nav,.search,.sort-ind{display:none !important}
  .panel,.kpi{box-shadow:none;break-inside:avoid}
  .table-scroll.tall{max-height:none}
}
</style>`;
}

function script(result: WorkbookComputeResult): string {
  const dataJson = JSON.stringify(serializeResult(result)).replace(/</g, '\\u003c');
  return String.raw`<script>
(function(){
  var DATA = __DATA__;
  var root=document.documentElement;
  var saved=null; try{saved=localStorage.getItem('traderlog_report_theme');}catch(e){}
  if(saved){root.setAttribute('data-theme',saved);}
  document.getElementById('themeBtn').addEventListener('click',function(){
    var next=root.getAttribute('data-theme')==='dark'?'light':'dark';
    root.setAttribute('data-theme',next);
    try{localStorage.setItem('traderlog_report_theme',next);}catch(e){}
  });
  document.getElementById('printBtn').addEventListener('click',function(){window.print();});

  function key(y,m,d){
    return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  }
  function money(v,c){
    var sign=v<0?'-':'+';
    return sign+Math.abs(v).toFixed(2)+' '+c;
  }
  var dayMap={};
  DATA.days.forEach(function(d){dayMap[d.date]=d;});
  var year=DATA.settings.calendarYear;
  var month=DATA.settings.calendarMonth;
  var todayKey=(function(){var t=new Date();return key(t.getFullYear(),t.getMonth(),t.getDate());})();
  var limit=DATA.settings.dailyLossLimit||0;
  var names=['MON','TUE','WED','THU','FRI','SAT','SUN'];

  function renderCalendar(){
    var title=new Date(year,month-1,1).toLocaleString('en-US',{month:'long',year:'numeric'}).toUpperCase();
    var html='<div class="panel-head"><div><h2>'+title+'</h2><p class="hint">Daily P/L · trade counts · week totals</p></div></div>';
    html+='<div class="calendar">';
    names.forEach(function(n){html+='<div class="cal-head">'+n+'</div>';});
    html+='<div class="cal-head">WEEK</div>';
    var first=new Date(year,month-1,1);
    var offset=(first.getDay()+6)%7;
    var start=new Date(year,month-1,1-offset);
    for(var w=0;w<6;w++){
      var weekPnl=0,weekTrades=0;
      for(var d=0;d<7;d++){
        var cell=new Date(start.getFullYear(),start.getMonth(),start.getDate()+w*7+d);
        var inMonth=cell.getMonth()===month-1 && cell.getFullYear()===year;
        var k=key(cell.getFullYear(),cell.getMonth(),cell.getDate());
        var stat=dayMap[k];
        var cls='cal-day'+(inMonth?'':' muted');
        if(stat){
          if(stat.pnl>0)cls+=' good';
          if(stat.pnl<0)cls+=' bad';
          if(limit>0 && stat.pnl<-limit)cls+=' limit';
          weekPnl+=stat.pnl;weekTrades+=stat.tradeCount;
        }
        if(k===todayKey)cls+=' today';
        html+='<div class="'+cls+'"><span class="cal-date">'+cell.getDate()+'</span>';
        html+='<span class="cal-pnl">'+(stat?money(stat.pnl,DATA.settings.currency):'')+'</span>';
        html+='<span class="cal-count">'+(stat?(stat.tradeCount+' trade'+(stat.tradeCount===1?'':'s')):'')+'</span></div>';
      }
      html+='<div class="week-total"><span class="cal-date">Week '+(w+1)+'</span>';
      html+='<span class="cal-pnl">'+(weekTrades?money(weekPnl,DATA.settings.currency):'')+'</span>';
      html+='<span class="cal-count">'+(weekTrades?weekTrades+' trades':'')+'</span></div>';
    }
    html+='</div>';
    document.getElementById('calendar').innerHTML=html;
  }
  function shift(delta){
    month+=delta;
    if(month<1){month=12;year--;}
    if(month>12){month=1;year++;}
    renderCalendar();
  }
  document.getElementById('prevMonth').addEventListener('click',function(){shift(-1);});
  document.getElementById('nextMonth').addEventListener('click',function(){shift(1);});
  renderCalendar();

  var search=document.getElementById('tradeSearch');
  var tbody=document.querySelector('#tradeTable tbody');
  if(search&&tbody){
    var rows=Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    function apply(){
      var q=search.value.toLowerCase().trim();
      rows.forEach(function(tr){tr.style.display=tr.textContent.toLowerCase().indexOf(q)>=0?'':'none';});
    }
    search.addEventListener('input',apply);
    var headers=Array.prototype.slice.call(document.querySelectorAll('#tradeTable th[data-sort]'));
    headers.forEach(function(th,idx){
      th.addEventListener('click',function(){
        var asc=th.getAttribute('data-asc')!=='1';
        headers.forEach(function(h){h.setAttribute('data-asc','0');});
        th.setAttribute('data-asc',asc?'1':'0');
        var sorted=rows.slice().sort(function(a,b){
          var av=(a.getAttribute('data-v'+idx)||'').toLowerCase();
          var bv=(b.getAttribute('data-v'+idx)||'').toLowerCase();
          var an=parseFloat(av.replace(/[^0-9.\-]/g,''));
          var bn=parseFloat(bv.replace(/[^0-9.\-]/g,''));
          var cmp;
          if(!isNaN(an)&&!isNaN(bn)){cmp=an-bn;}else{cmp=av.localeCompare(bv);}
          return asc?cmp:-cmp;
        });
        sorted.forEach(function(tr){tbody.appendChild(tr);});
        apply();
      });
    });
  }
})();
</script>`.replace('__DATA__', dataJson);
}

function svgEquity(points: Array<{ tradeNumber: number; equity: number }>): string {
  const w = 760;
  const h = 240;
  const pad = 36;
  if (!points.length) return `<svg viewBox="0 0 ${w} ${h}"></svg>`;
  const values = points.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.abs(max - min) < 0.01 ? 1 : max - min;
  const coords = points
    .map((point, index) => {
      const x = points.length === 1 ? pad : pad + (index * (w - pad * 2)) / (points.length - 1);
      const y = h - pad - ((point.equity - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const polyline = points.length === 1 ? `${coords} ${coords}` : coords;
  return `
<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Equity curve">
  <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="var(--line)"/>
  <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="var(--line)"/>
  <text x="${pad}" y="18" font-size="10" fill="var(--muted)">${num(max)}</text>
  <text x="${pad}" y="${h - 8}" font-size="10" fill="var(--muted)">${num(min)}</text>
  <polyline points="${polyline}" fill="none" stroke="#0E7C86" stroke-width="2.5" stroke-linejoin="round"/>
</svg>`;
}

function svgDonut(wins: number, losses: number, breakevens: number): string {
  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  const total = wins + losses + breakevens;
  const segments: string[] = [];
  if (total > 0) {
    let offset = 0;
    const parts: Array<[number, string, string]> = [
      [wins, '#1B7F4C', 'Wins'],
      [losses, '#C0392B', 'Losses'],
      [breakevens, '#B7791F', 'Break-even'],
    ];
    for (const [count, color, label] of parts) {
      if (!count) continue;
      const length = (circumference * count) / total;
      segments.push(
        `<circle cx="100" cy="100" r="${radius}" fill="none" stroke="${color}" ` +
          `stroke-width="22" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" ` +
          `stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 100 100)">` +
          `<title>${label}: ${count}</title></circle>`,
      );
      offset += length;
    }
  } else {
    segments.push(
      `<circle cx="100" cy="100" r="${radius}" fill="none" stroke="var(--line)" stroke-width="22"><title>No closed trades</title></circle>`,
    );
  }
  return `
<svg viewBox="0 0 200 200" role="img" aria-label="Outcome mix">
  ${segments.join('')}
  <text x="100" y="95" text-anchor="middle" font-size="20" font-weight="700" fill="var(--navy)">${total}</text>
  <text x="100" y="114" text-anchor="middle" font-size="9" fill="var(--muted)">CLOSED</text>
</svg>`;
}

function svgBars(values: number[], labels: string[]): string {
  const w = 760;
  const h = 220;
  const pad = 34;
  if (!values.length) return `<svg viewBox="0 0 ${w} ${h}"></svg>`;
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)));
  const scale = maxAbs <= 0 ? 1 : maxAbs;
  const zeroY = h / 2;
  const slot = (w - pad * 2) / values.length;
  const barW = Math.max(2, Math.min(28, slot * 0.7));
  const bars = values
    .map((value, index) => {
      const x = pad + index * slot + (slot - barW) / 2;
      const barH = (Math.abs(value) / scale) * ((h - pad * 2) / 2);
      const y = value >= 0 ? zeroY - barH : zeroY;
      const color = value >= 0 ? '#1B7F4C' : '#C0392B';
      const label = index < labels.length ? labels[index] : '';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="2"><title>${esc(label)}: ${num(value)}</title></rect>`;
    })
    .join('');
  const labelHtml = labels
    .map((label, index) => {
      if (labels.length > 12 && index % 2 === 1) return '';
      const x = pad + index * slot + slot / 2;
      return `<text x="${x.toFixed(1)}" y="${h - 10}" text-anchor="middle" font-size="9" fill="var(--muted)">${esc(label)}</text>`;
    })
    .join('');
  return `
<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="P/L bars">
  <line x1="${pad}" y1="${zeroY}" x2="${w - pad}" y2="${zeroY}" stroke="var(--line)"/>
  ${bars}
  ${labelHtml}
</svg>`;
}

function svgMonthBars(months: WorkbookComputeResult['months']): string {
  return svgBars(
    months.map((m) => m.netPnl),
    months.map((m) => m.label),
  );
}

function outcomeLabel(outcome: WorkbookOutcome): string {
  switch (outcome) {
    case 'Win':
      return 'Win';
    case 'Loss':
      return 'Loss';
    case 'BE':
      return 'BE';
    default:
      return '';
  }
}

function pnlClass(value: number): string {
  return value > 0 ? 'good' : value < 0 ? 'bad' : '';
}

function num(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

function signedMoney(value: number, currency: string): string {
  const sign = value < 0 ? '-' : '+';
  return `${sign}${Math.abs(value).toFixed(2)} ${currency}`;
}

function pct(value: number | null | undefined): string {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function dateLabel(date: Date): string {
  const day = date.getDate().toString().padStart(2, '0');
  return `${day} ${monthName(date.getMonth() + 1)} ${date.getFullYear()}`;
}

function monthTitle(year: number, month: number): string {
  return `${monthName(month)} ${year}`;
}

function monthName(month: number): string {
  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return names[month - 1] ?? 'Month';
}

function esc(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
