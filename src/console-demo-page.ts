export const consoleDemoPage = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PayPal Operations — Demo</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#182230;font:15px system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:32px}h1{margin:0 0 8px;font-size:28px}.notice{padding:14px;background:#fff2cf;border-radius:8px;margin:20px 0}.toolbar{display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin-bottom:16px}label{display:grid;gap:6px;font-weight:600}select,button{font:inherit;padding:9px 14px;border:1px solid #a8b5c5;border-radius:6px;background:white}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}#queue{height:390px}.review{margin-top:20px;background:white;padding:20px;border:1px solid #d7e0ec;border-radius:10px}.actions{display:flex;gap:12px;margin:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f7fb;padding:14px}#status{min-height:24px;margin-top:12px}.muted{color:#526479}
</style>
<script src="/vendor/ag-grid-community.min.js" defer></script>
</head>
<body><main>
<h1>Operations review queue</h1>
<p class="muted">Fictional Store · disputes and unpaid invoices</p>
<div class="notice">Demo: all records and AI explanations are simulated. Reference time: <span id="reference">2026-10-25 12:00 UTC</span>. Approval requires the existing local terminal review.</div>
<div class="toolbar">
<label>Type<select id="type"><option value="">All types</option><option value="dispute">Disputes</option><option value="invoice">Invoices</option></select></label>
<label>Deadline<select id="deadline"><option value="all">All deadlines</option><option value="overdue">Overdue</option><option value="next24h">Next 24 hours</option></select></label>
<button id="refresh" type="button">Refresh queue</button>
</div>
<div id="queue" aria-label="Simulated operations queue"></div>
<section class="review" aria-labelledby="review-title">
<h2 id="review-title">Review selected item</h2>
<p id="selection">Select a row to inspect its deadline and simulated rationale.</p>
<pre id="details" hidden></pre>
<div class="actions"><button id="approve" type="button" disabled>Approve: open terminal instructions</button><button id="reject" type="button" disabled>Reject demo item</button></div>
<p id="status" role="status" aria-live="polite"></p>
</section>
</main>
<script>
'use strict';
window.addEventListener('DOMContentLoaded', () => {
  const element = (id) => document.getElementById(id);
  const status = element('status');
  const rejected = new Set();
  let selected = null;
  let requestNumber = 0;
  let grid = null;
  let statusMessage = '';
  function setStatus(message, api = grid) {
    statusMessage = message;
    let loaded = 0;
    if (api) api.forEachNode(() => { loaded++; });
    status.textContent = (api
      ? 'Showing ' + api.getDisplayedRowCount() + ' of ' + loaded + ' loaded simulated items. '
      : '') + message;
  }
  function clearSelection() {
    selected = null;
    if (grid && grid.getSelectedRows().length) grid.deselectAll();
    element('details').textContent = '';
    element('selection').textContent = 'Select a row to inspect its deadline and simulated rationale.';
    element('details').hidden = true;
    element('approve').disabled = true;
    element('reject').disabled = true;
  }
  if (!window.agGrid) {
    setStatus('The local AG Grid asset could not be loaded.');
    return;
  }
  grid = agGrid.createGrid(element('queue'), {
    columnDefs: [
      {field:'deadline',headerName:'Deadline (UTC)',sort:'asc',minWidth:205},
      {field:'type',headerName:'Type',width:125,filter:'agTextColumnFilter',floatingFilter:true},
      {field:'title',headerName:'Item',minWidth:260,flex:1,filter:'agTextColumnFilter',floatingFilter:true},
      {field:'amount',headerName:'USD',width:110,comparator:(a,b)=>Number(a)-Number(b)},
      {field:'simulatedAiRationale',headerName:'AI rationale — simulated',minWidth:330,flex:2,wrapText:true,autoHeight:true}
    ],
    defaultColDef:{sortable:true,resizable:true},
    rowData:[],
    rowSelection:{mode:'singleRow',checkboxes:false,enableClickSelection:true},
    getRowId:(params)=>params.data.id,
    onModelUpdated:(event)=>setStatus(statusMessage,event.api),
    onFilterChanged:(event)=>{
      let selectionVisible = !selected;
      if (selected) event.api.forEachNodeAfterFilter((node)=>{
        if (node.data && node.data.id === selected.id) selectionVisible = true;
      });
      if (!selectionVisible) clearSelection();
      setStatus(selectionVisible
        ? 'Column filters updated.'
        : 'Selection cleared because the selected item is hidden by the column filters.',event.api);
    },
    onSelectionChanged:(event)=>{
      selected=event.api.getSelectedRows()[0] || null;
      if (!selected) {clearSelection();return;}
      element('selection').textContent=selected.title;
      element('details').textContent=JSON.stringify(selected,null,2);
      element('details').hidden=false;
      element('approve').disabled=selected.type!=='invoice';
      element('reject').disabled=false;
      setStatus(selected.type==='dispute'
        ? 'Disputes are available for review. The existing approval control applies to invoice reminders.'
        : 'Review the invoice before preparing and approving an exact reminder proposal.');
    }
  });
  async function loadQueue() {
    const current=++requestNumber;
    clearSelection();
    setStatus('Loading simulated queue…');
    const query=new URLSearchParams({deadline:element('deadline').value});
    if(element('type').value) query.set('type',element('type').value);
    try {
      const response=await fetch('/api/demo/queue?'+query.toString(),{credentials:'omit',cache:'no-store'});
      if(!response.ok) throw new Error('Queue request failed');
      const body=await response.json();
      if(!Array.isArray(body.items)||!body.items.every(item=>item.simulated===true)) throw new Error('Invalid demo response');
      if(current!==requestNumber) return;
      const items=body.items.filter(item=>!rejected.has(item.id));
      grid.setGridOption('rowData',items);
      setStatus('Queue ordered by deadline.');
    } catch {
      if(current!==requestNumber) return;
      grid.setGridOption('rowData',[]);
      setStatus('Unable to load the demo queue. Check the local console server.');
    }
  }
  element('approve').addEventListener('click',async ()=>{
    if(!selected||selected.type!=='invoice') return;
    const item=selected;
    element('approve').disabled=true;
    setStatus('Preparing a simulated reminder draft for terminal review…');
    try {
      const response=await fetch('/api/demo/proposals',{
        method:'POST',
        credentials:'omit',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({itemId:item.id})
      });
      if(!response.ok) throw new Error('Draft request failed');
      const result=await response.json();
      const proposal=result.proposal;
      if(result.simulated!==true||result.approvalRecorded!==false||result.executed!==false||
         !proposal||typeof proposal.id!=='string'||
         !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proposal.id)||
         proposal.invoiceId!==item.id||typeof proposal.note!=='string') {
        throw new Error('Invalid draft response');
      }
      if(selected!==item) return;
      element('details').textContent=JSON.stringify({item,proposal},null,2);
      setStatus('Simulated draft saved. From the project directory, review it in an interactive terminal: PAYPAL_DATABASE_PATH=./demo-console.sqlite node dist/approve-reminder.js '+proposal.id+'. Review the exact invoice and message before confirming. No approval was recorded and no reminder was sent.');
    } catch {
      if(selected===item) setStatus('Could not confirm draft preparation. Retry to retrieve the same stored draft. No approval or send was requested.');
    } finally {
      element('approve').disabled=!selected||selected.type!=='invoice';
    }
  });
  element('reject').addEventListener('click',()=>{
    if(!selected) return;
    const id=selected.id;
    rejected.add(id);
    grid.applyTransaction({remove:[selected]});
    clearSelection();
    setStatus(id+' rejected in this browser session. No reminder was executed.');
  });
  element('type').addEventListener('change',loadQueue);
  element('deadline').addEventListener('change',loadQueue);
  element('refresh').addEventListener('click',loadQueue);
  loadQueue();
});
</script>
</body>
</html>`;
