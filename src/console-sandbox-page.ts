export const consoleSandboxPage = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sandbox invoice review</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#182230;font:15px system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:28px}section{background:white;border:1px solid #d7e0ec;border-radius:8px;padding:18px;margin:18px 0}.notice{background:#fff2cf;padding:14px}button,select{font:inherit;padding:9px;max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f7fb;padding:14px}#queue{height:360px}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}li{margin:12px 0;overflow-wrap:anywhere}
</style>
<script src="/vendor/ag-grid-community.min.js" defer></script>
</head>
<body><main>
<h1>Sandbox invoice review</h1>
<p class="notice">PayPal sandbox. This console only reads data. Human approval happens in the terminal. Recipient delivery is not verified.</p>
<p><a href="/">Open the separate fictional demo</a></p>
<section aria-labelledby="queue-title">
<div class="toolbar"><h2 id="queue-title">Unpaid invoices</h2><button id="refresh" type="button">Refresh sandbox data</button></div>
<p id="queue-status" role="status" aria-live="polite"></p>
<div id="queue" aria-label="Sandbox unpaid invoices"></div><p id="limitations"></p>
<h3>Priority explanation</h3>
<p>Reminder counts and dispute status are unknown. The comparison is hypothetical and requires manual review.</p>
<pre id="priority">Select an invoice.</pre>
</section>
<section aria-labelledby="history-title">
<h2 id="history-title">Selected invoice workflow</h2>
<p id="selected-invoice">Select an invoice to see its local proposals.</p>
<label for="proposals">Proposal for this invoice</label> <select id="proposals" disabled><option value="">Select a proposal</option></select>
<p id="proposal-status" role="status" aria-live="polite"></p>
<p id="result" role="status" aria-live="polite">No proposal selected.</p>
<ol id="timeline" aria-label="Persisted workflow stages"></ol>
<h3>Reconciliation reviews</h3><p id="reconciliation">No proposal selected.</p><ul id="reviews"></ul>
<p>Review the complete message in the approval terminal. Historical approval grants no current permission. Missing local records do not prove that no remote action occurred.</p>
<details><summary>Local history details</summary><pre id="history">Select a proposal.</pre></details>
</section>
</main><script>
'use strict';
window.addEventListener('DOMContentLoaded',()=>{
  const el=id=>document.getElementById(id);
  let generation=0,selectionGeneration=0,historyGeneration=0,snapshotId=null,selectedInvoice=null,proposalItems=[];
  async function read(path){
    const response=await fetch(path,{credentials:'omit',cache:'no-store'});
    if(!response.ok)throw new Error('Read unavailable');
    const body=await response.json();
    if(body.mode!=='sandbox'||body.readOnly!==true)throw new Error('Unexpected mode');
    return body;
  }
  function clearHistory(message){
    ++historyGeneration;el('result').textContent=message;el('history').textContent=message;
    el('timeline').replaceChildren();el('reviews').replaceChildren();el('reconciliation').textContent='No review displayed.';
  }
  function filterProposals(){
    el('proposals').replaceChildren(new Option('Select a proposal',''));clearHistory('Select a proposal.');
    const matches=proposalItems.filter(item=>item.invoiceId===selectedInvoice&&item.proposalId);
    for(const item of matches){const option=new Option(item.proposalId+' · '+(item.createdAt||'Unknown date'),item.proposalId);el('proposals').append(option);}
    el('proposals').disabled=!selectedInvoice||!matches.length;
    el('selected-invoice').textContent=selectedInvoice?'Selected sandbox invoice: '+selectedInvoice:'Select an invoice to see its local proposals.';
    el('proposal-status').textContent=selectedInvoice?matches.length+' matching proposals in the loaded local page.':'No invoice selected.';
  }
  function line(parent,text){const item=document.createElement('li');item.textContent=text;parent.append(item);}
  function showHistory(history,id,invoice){
    const stages=history?.timeline;
    if(history?.proposalId!==id||history.found!==true||!Array.isArray(stages))throw new Error('Invalid history');
    const proposal=stages.find(entry=>entry.stage==='proposal');
    if(proposal?.data?.proposalId!==id||proposal.data.invoiceId!==invoice)throw new Error('Mismatched operation');
    const result=stages.find(entry=>entry.stage==='result');
    el('result').textContent=result?.status==='succeeded'&&result.confirmed===true
      ?'Local executor recorded success. Recipient delivery remains unverified.'
      :result?.recorded?'Execution outcome is uncertain. Do not resend.':'No local execution attempt is recorded. Remote activity remains unverified.';
    el('timeline').replaceChildren();
    const labels={proposal:'Proposal saved',approval:'Historical human approval',execution_attempt:'Execution attempt',result:'Recorded execution result'};
    for(const stage of stages)line(el('timeline'),(labels[stage.stage]||'Unknown stage')+': '+(stage.recorded?(stage.at||'Time unavailable'):'Not recorded')+(stage.data?.attemptId?' · Attempt '+stage.data.attemptId:''));
    el('reviews').replaceChildren();const reconciliation=history.reconciliation;
    el('reconciliation').textContent=reconciliation?.available
      ?'Local operator observations preserve the original result and never authorize another send. Evidence and recipient delivery are not independently verified.'
      :'No reconciliation review store is available in this snapshot.';
    for(const review of reconciliation?.reviews||[])line(el('reviews'),(review.recordedAt||'Unknown time')+' · '+(review.operatorReportedOutcome||'Unknown outcome')+' · '+(review.evidenceKind||'Unknown evidence'));
    if(reconciliation?.hasMore)line(el('reviews'),'Additional reviews exist.');
    el('history').textContent=JSON.stringify(history,null,2);
  }
  if(!window.agGrid){el('queue-status').textContent='The local grid asset is unavailable.';return;}
  const grid=agGrid.createGrid(el('queue'),{
    columnDefs:[{field:'id',headerName:'Invoice',flex:1,minWidth:220},{field:'status',headerName:'Status',minWidth:140},
      {colId:'amount',headerName:'Outstanding',valueGetter:p=>p.data.amount?p.data.amount.value+' '+p.data.amount.currency:'Unknown',minWidth:160},
      {field:'deadline',headerName:'Due date (UTC convention)',valueFormatter:p=>p.value||'Unknown',minWidth:220}],
    defaultColDef:{sortable:true,resizable:true},rowData:[],getRowId:p=>p.data.id,
    rowSelection:{mode:'singleRow',checkboxes:false,enableClickSelection:true},
    onSelectionChanged:async event=>{
      const current=++selectionGeneration,row=event.api.getSelectedRows()[0],snapshot=snapshotId;
      selectedInvoice=row?.id||null;filterProposals();el('priority').textContent='Select an invoice.';
      if(!row||!snapshot)return;el('priority').textContent='Reading priority explanation…';
      try{const body=await read('/api/sandbox/priority?'+new URLSearchParams({invoiceId:row.id,snapshotId:snapshot}));
        if(current===selectionGeneration&&snapshot===snapshotId)el('priority').textContent=JSON.stringify(body,null,2);
      }catch{if(current===selectionGeneration)el('priority').textContent='Explanation unavailable. Refresh and select again.';}
    }
  });
  el('proposals').addEventListener('change',async()=>{
    const id=el('proposals').value,invoice=selectedInvoice;clearHistory(id?'Reading local history…':'Select a proposal.');const current=historyGeneration;
    if(!id||!invoice)return;
    try{const body=await read('/api/sandbox/history?'+new URLSearchParams({proposalId:id}));
      if(current===historyGeneration&&invoice===selectedInvoice)showHistory(body.history,id,invoice);
    }catch{if(current===historyGeneration)clearHistory('Local history unavailable. No action was executed.');}
  });
  async function refresh(){
    const current=++generation;++selectionGeneration;snapshotId=null;selectedInvoice=null;proposalItems=[];
    grid.setGridOption('rowData',[]);filterProposals();el('priority').textContent='Select an invoice.';el('limitations').textContent='';
    el('queue-status').textContent='Reading sandbox invoices…';el('proposal-status').textContent='Reading local proposals…';
    await Promise.all([
      (async()=>{try{const body=await read('/api/sandbox/queue');if(current!==generation)return;
        if(!Array.isArray(body.items)||typeof body.snapshotId!=='string')throw new Error('Invalid queue');
        snapshotId=body.snapshotId;grid.setGridOption('rowData',body.items);el('queue-status').textContent=body.items.length+' sandbox invoices. Snapshot: '+body.asOf;
        el('limitations').textContent=(body.limitations||[]).join(' ')+(body.pagination?.hasMore?' Additional invoice pages exist.':'');
      }catch{if(current===generation)el('queue-status').textContent='Sandbox queue unavailable. No action was executed.';}})(),
      (async()=>{try{const body=await read('/api/sandbox/proposals');if(current!==generation)return;
        if(!Array.isArray(body.proposals?.items))throw new Error('Invalid proposals');proposalItems=body.proposals.items;filterProposals();
        if(body.proposals.hasMore)el('proposal-status').textContent+=' Only the latest 100 local proposals were loaded.';
      }catch{if(current===generation)el('proposal-status').textContent='Local proposal reading is unavailable.';}})()
    ]);
  }
  el('refresh').addEventListener('click',refresh);void refresh();
});
</script></body></html>`;
