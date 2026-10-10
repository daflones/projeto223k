import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnnouncementTracker,welcomeCouponOffer} from '../src/lib/notices.js';

function availableStatus() {
  return {redeemed:false,coupon:{code:'ELETRIFY',active:true,remaining_user:1,max_selections:1,options:[
    {kind:'balance',amount_cents:500},
    {kind:'custom',price_cents:1000,daily_bps:500,duration_days:10},
  ]}};
}

test('Community notice is remembered independently for each account',()=>{
  const values=new Map();
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const notices=createAnnouncementTracker(()=>storage);
  assert.equal(notices.shouldShow(null),false);
  assert.equal(notices.shouldShow('account-a'),true);
  notices.acknowledge('account-a');
  assert.equal(notices.shouldShow('account-a'),false);
  assert.equal(notices.shouldShow('account-b'),true);
  assert.equal(createAnnouncementTracker(()=>storage).shouldShow('account-a'),false);
});

test('Restricted browser storage does not break the dashboard or repeat a dismissed notice during the visit',()=>{
  const notices=createAnnouncementTracker(()=>{throw new Error('Storage is unavailable');});
  assert.equal(notices.shouldShow('account-a'),true);
  notices.acknowledge('account-a');
  assert.equal(notices.shouldShow('account-a'),false);
  assert.equal(notices.shouldShow('account-b'),true);
});

test('Welcome offer requires confirmed eligibility and the two advertised alternatives',()=>{
  const status=availableStatus();
  assert.equal(welcomeCouponOffer(status),status.coupon);
  for(const input of [null,{}, {...status,redeemed:true}, {...status,redeemed:undefined}]) {
    assert.equal(welcomeCouponOffer(input),null);
  }
  for(const changes of [{active:false},{remaining_user:0},{remaining_user:undefined},{code:'OUTRO'},{max_selections:2}]) {
    assert.equal(welcomeCouponOffer({redeemed:false,coupon:{...status.coupon,...changes}}),null);
  }
  for(const changes of [{price_cents:7000},{daily_bps:800},{duration_days:15}]) {
    const mismatch=availableStatus();Object.assign(mismatch.coupon.options[1],changes);
    assert.equal(welcomeCouponOffer(mismatch),null);
  }
});
