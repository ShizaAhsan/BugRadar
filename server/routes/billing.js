const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

// Webhook route must be before authenticate middleware
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    const payload = JSON.stringify(req.body);
    const expectedSig = crypto.createHmac('sha256', config.webhookSecret).update(payload).digest('hex');

    if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const { event, organization_id } = req.body;

    if (event === 'payment.success') {
      await query(
        `UPDATE subscriptions SET
          plan = 'pro', status = 'active',
          current_period_start = NOW(),
          current_period_end = NOW() + INTERVAL '30 days',
          updated_at = NOW()
         WHERE organization_id = $1`,
        [organization_id]
      );
      await query(
        'UPDATE organizations SET plan = $1, updated_at = NOW() WHERE id = $2',
        ['pro', organization_id]
      );
    } else if (event === 'payment.failed') {
      await query(
        `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
         WHERE organization_id = $1`,
        [organization_id]
      );
    } else if (event === 'subscription.cancelled') {
      await query(
        `UPDATE subscriptions SET plan = 'free', status = 'active', updated_at = NOW()
         WHERE organization_id = $1`,
        [organization_id]
      );
      await query(
        'UPDATE organizations SET plan = $1, updated_at = NOW() WHERE id = $2',
        ['free', organization_id]
      );
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

router.use(authenticate);

async function checkOrgAccess(orgId, userId) {
  const membership = await query(
    'SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2',
    [userId, orgId]
  );
  if (membership.rows.length === 0) return null;
  return membership.rows[0].role;
}

router.get('/org/:orgId', async (req, res) => {
  try {
    const role = await checkOrgAccess(req.params.orgId, req.user.id);
    if (!role) {
      return res.status(403).json({ error: 'No access to this organization' });
    }

    const result = await query(
      'SELECT * FROM subscriptions WHERE organization_id = $1',
      [req.params.orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    const sub = result.rows[0];
    const planConfig = config.plans[sub.plan] || config.plans.free;

    res.json({
      ...sub,
      limits: planConfig,
      usage_percentage: Math.round((sub.events_used / planConfig.maxEventsPerMonth) * 100),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get billing info' });
  }
});

router.post('/org/:orgId/checkout', async (req, res) => {
  try {
    const role = await checkOrgAccess(req.params.orgId, req.user.id);
    if (!role) {
      return res.status(403).json({ error: 'No access to this organization' });
    }

    if (role !== 'owner') {
      return res.status(403).json({ error: 'Only owner can manage billing' });
    }

    const { plan } = req.body;
    if (plan !== 'pro') {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const orgResult = await query('SELECT * FROM organizations WHERE id = $1', [req.params.orgId]);
    if (orgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const existing = await query(
      'SELECT * FROM subscriptions WHERE organization_id = $1',
      [req.params.orgId]
    );

    if (existing.rows.length > 0) {
      await query(
        `UPDATE subscriptions SET plan = 'pro', status = 'pending',
         payment_provider = 'stripe', updated_at = NOW()
         WHERE organization_id = $1`,
        [req.params.orgId]
      );
    } else {
      await query(
        `INSERT INTO subscriptions (organization_id, plan, status, payment_provider, current_period_end)
         VALUES ($1, 'pro', 'pending', 'stripe', NOW() + INTERVAL '30 days')`,
        [req.params.orgId]
      );
    }

    // In production, create a Stripe Checkout Session here:
    // const session = await stripe.checkout.sessions.create({...});
    // res.json({ checkout_url: session.url });

    // For demo: return a direct confirm URL
    res.json({
      checkout_url: `/billing/checkout?org=${req.params.orgId}&plan=pro&demo=true`,
      provider: 'stripe',
      amount: config.plans.pro.priceUsd,
      currency: 'USD',
    });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Failed to initiate checkout' });
  }
});

router.post('/org/:orgId/checkout/confirm', async (req, res) => {
  try {
    const role = await checkOrgAccess(req.params.orgId, req.user.id);
    if (!role || role !== 'owner') {
      return res.status(403).json({ error: 'Only owner can confirm payment' });
    }

    const { orgId } = req.params;

    await query(
      `UPDATE subscriptions SET
        plan = 'pro', status = 'active',
        current_period_start = NOW(),
        current_period_end = NOW() + INTERVAL '30 days',
        events_used = 0,
        updated_at = NOW()
       WHERE organization_id = $1`,
      [orgId]
    );

    await query(
      'UPDATE organizations SET plan = $1, updated_at = NOW() WHERE id = $2',
      ['pro', orgId]
    );

    await query(
      `INSERT INTO audit_log (organization_id, user_id, action, details)
       VALUES ($1, $2, $3, $4)`,
      [orgId, req.user.id, 'billing.upgraded', JSON.stringify({ plan: 'pro' })]
    );

    res.json({ message: 'Subscription activated', plan: 'pro' });
  } catch (err) {
    console.error('Confirm checkout error:', err);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

router.post('/org/:orgId/downgrade', async (req, res) => {
  try {
    const role = await checkOrgAccess(req.params.orgId, req.user.id);
    if (!role || role !== 'owner') {
      return res.status(403).json({ error: 'Only owner can manage billing' });
    }

    await query(
      `UPDATE subscriptions SET plan = 'free', status = 'active', updated_at = NOW()
       WHERE organization_id = $1`,
      [req.params.orgId]
    );
    await query(
      'UPDATE organizations SET plan = $1, updated_at = NOW() WHERE id = $2',
      ['free', req.params.orgId]
    );

    await query(
      `INSERT INTO audit_log (organization_id, user_id, action, details)
       VALUES ($1, $2, $3, $4)`,
      [req.params.orgId, req.user.id, 'billing.downgraded', JSON.stringify({ plan: 'free' })]
    );

    res.json({ message: 'Downgraded to free plan' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to downgrade' });
  }
});

module.exports = router;
