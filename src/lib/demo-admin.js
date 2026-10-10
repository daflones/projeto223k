// Development-only adapter for the real paginated admin interface.
const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
function check(state){if(!state.profile.is_admin||state.profile.blocked)throw new Error('Acesso administrativo negado');}
function team(state,id){
 const users=state.admin.users,root=state.profile.id;
 const parent=u=>u.referred_by||(u.level===1?root:state.team.find(t=>t.level===u.level-1)?.id);
 let previous=[id],result=[],visited=new Set(previous);
 for(let level=1;level<=3;level++){
  const next=users.filter(u=>previous.includes(parent(u))&&!visited.has(u.id));
  for(const u of next){visited.add(u.id);result.push({...u,level});}
  previous=next.map(u=>u.id);
 }
 return result;
}
export function demoAdminOverview(state){check(state);return {users_count:state.admin.users.length,position_counts:state.admin.position_counts,available_cents:sum(state.admin.users.map(u=>u.wallet),'available_cents'),reserved_cents:sum(state.admin.users.map(u=>u.wallet),'reserved_cents'),pending_withdrawals:state.withdrawals.filter(w=>w.status==='requested').length,pending_withdrawal_cents:sum(state.withdrawals.filter(w=>w.status==='requested'),'amount_cents'),completed_deposits:state.deposits.filter(d=>d.status==='completed').length,review_webhooks:state.admin.webhooks.filter(w=>w.status==='review').length};}
export function demoAdminProfile(state,id){
 check(state);const user=state.admin.users.find(u=>u.id===id);if(!user)throw new Error('Usuário não encontrado');
 const positions=state.positions.filter(p=>p.user_id===id),commissions=state.commissions.filter(c=>c.user_id===id),members=team(state,id);
 return {user,sponsor:state.admin.users.find(u=>u.id===user.referred_by)||null,products_count:positions.length,active_products:positions.filter(p=>p.status==='active').length,invested_cents:sum(positions.filter(p=>p.status==='active'),'principal_cents'),earned_cents:sum(positions,'earned_cents'),commissions_cents:sum(commissions,'amount_cents'),levels:[1,2,3].map(level=>({level,total:members.filter(t=>t.level===level).length,active:members.filter(t=>t.level===level&&state.positions.some(p=>p.user_id===t.id&&p.status==='active')).length,commissions_cents:sum(commissions.filter(c=>c.level===level),'amount_cents')}))};
}
export function demoAdminPage(state,{section,page=1,page_size=20,search='',status='',user_id=null,level=1}){
 check(state);const user=id=>state.admin.users.find(u=>u.id===id)||{};
 let rows;
 if(section==='users')rows=state.admin.users.map(u=>({...u,commissions_cents:sum(state.commissions.filter(c=>c.user_id===u.id),'amount_cents')}));
 else if(section==='products')rows=state.products;
 else if(['positions','withdrawals','deposits'].includes(section))rows=state[section].filter(p=>!user_id||p.user_id===user_id).map(p=>({...p,user_name:user(p.user_id).full_name,user_whatsapp:user(p.user_id).whatsapp}));
 else if(section==='coupons')rows=state.coupons.map(c=>({...c,redeemed_count:state.couponRedemptions.filter(r=>r.coupon_id===c.id).length}));
 else if(['audit','webhooks'].includes(section))rows=state.admin[section];
 else if(section==='commissions')rows=state.commissions.filter(c=>!user_id||c.user_id===user_id).map(c=>({...c,source_name:user(c.source_user_id).full_name,source_whatsapp:user(c.source_user_id).whatsapp,product_name:state.positions.find(p=>p.id===c.position_id)?.name||'Produto'}));
 else if(section==='affiliates')rows=team(state,user_id).filter(t=>t.level===level).map(t=>{const products=state.positions.filter(p=>p.user_id===t.id);return {...t,active:products.some(p=>p.status==='active'),products_count:products.length,products:products.slice(0,3),commission_cents:sum(state.commissions.filter(c=>c.user_id===user_id&&c.source_user_id===t.id),'amount_cents')};});
 else throw new Error('Lista administrativa inválida');
 const term=search.trim().toLowerCase();
 rows=rows.filter(row=>!term||JSON.stringify(row).toLowerCase().includes(term)).filter(row=>{
  if(!status)return true;
  if(section==='users')return status==='blocked'?row.blocked:status==='admin'?row.is_admin:!row.blocked;
  if(['products','coupons','affiliates'].includes(section))return status==='active'?row.active:status==='paused'||status==='inactive'?!row.active:row.category===status;
  if(section==='commissions')return String(row.level)===status;
  return row.status===status;
 }).toSorted((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))||String(b.id||b.delivery_id).localeCompare(String(a.id||a.delivery_id)));
 const size=Math.max(1,Math.min(page_size,100)),total=rows.length,total_pages=Math.max(1,Math.ceil(total/size)),current=Math.max(1,Math.min(page,total_pages));
 return {items:rows.slice((current-1)*size,current*size),total,total_pages,page:current,page_size:size};
}
