export const COMMUNITY_NOTICE = Object.freeze({
  id: 'community-2026-10-10-BaQG9FSKZNYJXnJxNzVcyx',
  url: 'https://chat.whatsapp.com/BaQG9FSKZNYJXnJxNzVcyx',
});

export const WELCOME_COUPON_CODE = 'ELETRIFY';

// Acknowledgement is scoped to the announcement and the signed-in account.
// Restricted storage must not prevent the dashboard from opening.
export function createAnnouncementTracker(getStorage = () => globalThis.localStorage) {
  const acknowledged = new Set();
  const keyFor = userId => 'eletrify:notice:' + COMMUNITY_NOTICE.id + ':' + userId;
  return {
    shouldShow(userId) {
      if (typeof userId !== 'string' || !userId) return false;
      const key = keyFor(userId);
      if (acknowledged.has(key)) return false;
      try { return getStorage()?.getItem(key) !== 'read'; }
      catch { return true; }
    },
    acknowledge(userId) {
      if (typeof userId !== 'string' || !userId) return;
      const key = keyFor(userId);
      acknowledged.add(key);
      try { getStorage()?.setItem(key, 'read'); } catch {}
    },
  };
}

// Only advertise the offer after the server confirms this account has never
// redeemed it and the currently configured rewards match the announcement.
export function welcomeCouponOffer(status) {
  const coupon = status?.coupon;
  if (status?.redeemed !== false || coupon?.code !== WELCOME_COUPON_CODE ||
      coupon.active !== true || Number(coupon.remaining_user) < 1 ||
      !Number.isFinite(Number(coupon.remaining_user)) ||
      Number(coupon.max_selections) !== 1 || !Array.isArray(coupon.options) ||
      coupon.options.length !== 2) return null;
  const balance = coupon.options.filter(option => option.kind === 'balance' && Number(option.amount_cents) === 500);
  const product = coupon.options.filter(option => ['custom', 'product'].includes(option.kind) &&
    Number(option.price_cents) === 1000 && Number(option.daily_bps) === 500 && Number(option.duration_days) === 10);
  return balance.length === 1 && product.length === 1 ? coupon : null;
}
