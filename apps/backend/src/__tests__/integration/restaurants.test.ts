/**
 * Integration tests for Restaurant & Menu routes (MVP Module 2).
 *
 * Covers:
 *  - Public browse (GET /restaurants, GET /restaurants/:id)
 *  - Admin CRUD: restaurants, hours, categories, menu items
 *  - Availability toggle
 *  - Auth enforcement (non-admin blocked)
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildApp } from '../helpers/testApp';
import { resetDb, db } from '../helpers/testDb';

const { app, httpServer } = buildApp();

const JWT_SECRET      = process.env.JWT_SECRET || 'test-secret';
const ADMIN_USER_ID   = 'bbbbbbbb-0000-0000-0000-000000000001';
const DRIVER_USER_ID  = 'bbbbbbbb-0000-0000-0000-000000000002';

function makeToken(userId: string, role: string, name = 'Test User') {
  return jwt.sign({ sub: userId, role, name }, JWT_SECRET, { expiresIn: '1h' });
}

const adminToken  = makeToken(ADMIN_USER_ID,  'admin');
const driverToken = makeToken(DRIVER_USER_ID, 'driver');

const SAMPLE_RESTAURANT = {
  name:         'Taco Palace',
  description:  'Authentic street tacos',
  address:      '123 Main St, Los Angeles, CA',
  lat:          34.0522,
  lng:          -118.2437,
  phone:        '310-555-0100',
  cuisine_type: 'Mexican',
  image_url:    'https://example.com/taco.jpg',
};

beforeAll(async () => {
  await resetDb();
  // Seed admin + driver user records so foreign keys resolve
  await db.query(`
    INSERT INTO users (id, email, password_hash, role, full_name, email_verified)
    VALUES
      ($1, 'admin@teeneats.test',  'hash', 'admin',  'Test Admin',  TRUE),
      ($2, 'driver@teeneats.test', 'hash', 'driver', 'Test Driver', TRUE)
    ON CONFLICT (id) DO NOTHING
  `, [ADMIN_USER_ID, DRIVER_USER_ID]);

  await db.query(`
    INSERT INTO admin_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING
  `, [ADMIN_USER_ID]);
});

afterAll(async () => { httpServer.close(); await db.end(); });

// ─── Public: list restaurants ─────────────────────────────────────────────────

describe('GET /restaurants', () => {
  test('empty list initially', async () => {
    const res = await request(app).get('/restaurants');
    expect(res.status).toBe(200);
    expect(res.body.restaurants).toHaveLength(0);
  });

  test('returns only active restaurants', async () => {
    // Create one active, one inactive
    await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(SAMPLE_RESTAURANT);

    await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...SAMPLE_RESTAURANT, name: 'Inactive Place' });

    // Deactivate the second one
    const listRes = await request(app).get('/restaurants');
    const inactiveId = listRes.body.restaurants.find(
      (r: { name: string }) => r.name === 'Inactive Place'
    )?.id;
    if (inactiveId) {
      await request(app)
        .delete(`/restaurants/${inactiveId}`)
        .set('Authorization', `Bearer ${adminToken}`);
    }

    const res = await request(app).get('/restaurants');
    expect(res.status).toBe(200);
    expect(res.body.restaurants.every((r: { active?: boolean }) => r.active !== false)).toBe(true);
    const names = res.body.restaurants.map((r: { name: string }) => r.name);
    expect(names).not.toContain('Inactive Place');
    expect(names).toContain('Taco Palace');
  });

  test('response shape has expected fields', async () => {
    const res = await request(app).get('/restaurants');
    const r = res.body.restaurants[0];
    expect(r).toHaveProperty('id');
    expect(r).toHaveProperty('name');
    expect(r).toHaveProperty('cuisine_type');
    expect(r).toHaveProperty('lat');
    expect(r).toHaveProperty('lng');
    expect(r).not.toHaveProperty('active'); // not exposed in public list
  });
});

// ─── Public: restaurant detail ────────────────────────────────────────────────

describe('GET /restaurants/:id', () => {
  let restaurantId: string;
  let categoryId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...SAMPLE_RESTAURANT, name: 'Detail Test Restaurant' });
    restaurantId = res.body.restaurant.id;

    await request(app)
      .post(`/restaurants/${restaurantId}/hours`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hours: [{ day_of_week: 1, open_time: '11:00', close_time: '22:00' }] });

    const catRes = await request(app)
      .post(`/restaurants/${restaurantId}/categories`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Tacos', display_order: 0 });
    categoryId = catRes.body.category.id;

    await request(app)
      .post(`/restaurants/${restaurantId}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category_id:  categoryId,
        name:         'Carne Asada Taco',
        description:  'Grilled steak taco',
        price_cents:  450,
      });
  });

  test('returns restaurant with hours + categories + items', async () => {
    const res = await request(app).get(`/restaurants/${restaurantId}`);
    expect(res.status).toBe(200);

    const r = res.body.restaurant;
    expect(r.name).toBe('Detail Test Restaurant');
    expect(r.hours).toHaveLength(1);
    expect(r.hours[0].day_of_week).toBe(1);
    expect(r.categories).toHaveLength(1);
    expect(r.categories[0].name).toBe('Tacos');
    expect(r.categories[0].items).toHaveLength(1);
    expect(r.categories[0].items[0].name).toBe('Carne Asada Taco');
    expect(r.categories[0].items[0].price_cents).toBe(450);
  });

  test('inactive restaurant → 404', async () => {
    // Deactivate it
    await request(app)
      .delete(`/restaurants/${restaurantId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const res = await request(app).get(`/restaurants/${restaurantId}`);
    expect(res.status).toBe(404);

    // Reactivate for other tests (re-create as different name)
  });

  test('unknown id → 404', async () => {
    const res = await request(app).get('/restaurants/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  test('unavailable items are excluded from detail view', async () => {
    // Re-create a fresh restaurant for this test
    const restRes = await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...SAMPLE_RESTAURANT, name: 'Availability Test Restaurant' });
    const rid = restRes.body.restaurant.id;

    const catRes = await request(app)
      .post(`/restaurants/${rid}/categories`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Burgers', display_order: 0 });
    const cid = catRes.body.category.id;

    const itemRes = await request(app)
      .post(`/restaurants/${rid}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category_id: cid, name: 'Sold Out Burger', price_cents: 999 });
    const itemId = itemRes.body.item.id;

    // Mark unavailable
    await request(app)
      .patch(`/restaurants/menu-items/${itemId}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ available: false });

    const res = await request(app).get(`/restaurants/${rid}`);
    expect(res.body.restaurant.categories[0].items).toHaveLength(0);
  });
});

// ─── Admin: create restaurant ─────────────────────────────────────────────────

describe('POST /restaurants', () => {
  test('admin creates restaurant → 201', async () => {
    const res = await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...SAMPLE_RESTAURANT, name: 'New Restaurant' });

    expect(res.status).toBe(201);
    expect(res.body.restaurant.name).toBe('New Restaurant');
    expect(res.body.restaurant.active).toBe(true);
    expect(res.body.restaurant.id).toBeTruthy();
  });

  test('missing required field (cuisine_type) → 400', async () => {
    const { cuisine_type: _omit, ...payload } = SAMPLE_RESTAURANT;
    const res = await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cuisine_type/);
  });

  test('invalid lat (out of range) → 400', async () => {
    const res = await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...SAMPLE_RESTAURANT, lat: 200 });
    expect(res.status).toBe(400);
  });

  test('invalid lng → 400', async () => {
    const res = await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...SAMPLE_RESTAURANT, lng: -200 });
    expect(res.status).toBe(400);
  });

  test('non-admin (driver) → 403', async () => {
    const res = await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${driverToken}`)
      .send(SAMPLE_RESTAURANT);
    expect(res.status).toBe(403);
  });

  test('no auth → 401', async () => {
    const res = await request(app).post('/restaurants').send(SAMPLE_RESTAURANT);
    expect(res.status).toBe(401);
  });
});

// ─── Admin: update restaurant ─────────────────────────────────────────────────

describe('PUT /restaurants/:id', () => {
  let rid: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...SAMPLE_RESTAURANT, name: 'Update Test' });
    rid = res.body.restaurant.id;
  });

  test('update name → 200, name changed', async () => {
    const res = await request(app)
      .put(`/restaurants/${rid}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.restaurant.name).toBe('Updated Name');
  });

  test('partial update — only supplied fields change', async () => {
    const res = await request(app)
      .put(`/restaurants/${rid}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phone: '555-9999' });

    expect(res.status).toBe(200);
    expect(res.body.restaurant.phone).toBe('555-9999');
    expect(res.body.restaurant.name).toBe('Updated Name'); // unchanged
  });

  test('unknown restaurant → 404', async () => {
    const res = await request(app)
      .put('/restaurants/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });

  test('non-admin → 403', async () => {
    const res = await request(app)
      .put(`/restaurants/${rid}`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ name: 'Hack' });
    expect(res.status).toBe(403);
  });
});

// ─── Admin: deactivate restaurant ────────────────────────────────────────────

describe('DELETE /restaurants/:id', () => {
  let rid: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...SAMPLE_RESTAURANT, name: 'To Be Deleted' });
    rid = res.body.restaurant.id;
  });

  test('deactivate → 200, active = false', async () => {
    const res = await request(app)
      .delete(`/restaurants/${rid}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.restaurant.active).toBe(false);
  });

  test('deactivated restaurant not in public list', async () => {
    const res = await request(app).get('/restaurants');
    const ids = res.body.restaurants.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(rid);
  });

  test('unknown restaurant → 404', async () => {
    const res = await request(app)
      .delete('/restaurants/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ─── Admin: restaurant hours ──────────────────────────────────────────────────

describe('POST /restaurants/:id/hours', () => {
  let rid: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...SAMPLE_RESTAURANT, name: 'Hours Test Restaurant' });
    rid = res.body.restaurant.id;
  });

  test('set hours → 200, returns hours array', async () => {
    const res = await request(app)
      .post(`/restaurants/${rid}/hours`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        hours: [
          { day_of_week: 1, open_time: '11:00', close_time: '22:00' },
          { day_of_week: 2, open_time: '11:00', close_time: '22:00' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.hours).toHaveLength(2);
  });

  test('replace hours — second call overwrites first', async () => {
    await request(app)
      .post(`/restaurants/${rid}/hours`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hours: [{ day_of_week: 0, open_time: '12:00', close_time: '20:00' }] });

    const detailRes = await request(app).get(`/restaurants/${rid}`);
    expect(detailRes.body.restaurant.hours).toHaveLength(1);
    expect(detailRes.body.restaurant.hours[0].day_of_week).toBe(0);
  });

  test('invalid day_of_week (7) → 400', async () => {
    const res = await request(app)
      .post(`/restaurants/${rid}/hours`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hours: [{ day_of_week: 7, open_time: '10:00', close_time: '22:00' }] });
    expect(res.status).toBe(400);
  });

  test('open_time >= close_time → 400', async () => {
    const res = await request(app)
      .post(`/restaurants/${rid}/hours`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hours: [{ day_of_week: 1, open_time: '22:00', close_time: '11:00' }] });
    expect(res.status).toBe(400);
  });

  test('hours is not an array → 400', async () => {
    const res = await request(app)
      .post(`/restaurants/${rid}/hours`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hours: 'monday to friday' });
    expect(res.status).toBe(400);
  });

  test('non-admin → 403', async () => {
    const res = await request(app)
      .post(`/restaurants/${rid}/hours`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ hours: [] });
    expect(res.status).toBe(403);
  });
});

// ─── Admin: menu categories ───────────────────────────────────────────────────

describe('Menu categories', () => {
  let rid: string;
  let cid: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...SAMPLE_RESTAURANT, name: 'Category Test Restaurant' });
    rid = res.body.restaurant.id;
  });

  test('POST /restaurants/:id/categories → 201', async () => {
    const res = await request(app)
      .post(`/restaurants/${rid}/categories`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Appetizers', display_order: 0 });

    expect(res.status).toBe(201);
    expect(res.body.category.name).toBe('Appetizers');
    cid = res.body.category.id;
  });

  test('missing name → 400', async () => {
    const res = await request(app)
      .post(`/restaurants/${rid}/categories`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ display_order: 1 });
    expect(res.status).toBe(400);
  });

  test('PUT category → 200, name updated', async () => {
    const res = await request(app)
      .put(`/restaurants/${rid}/categories/${cid}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Starters' });

    expect(res.status).toBe(200);
    expect(res.body.category.name).toBe('Starters');
  });

  test('PUT category wrong restaurant → 404', async () => {
    const res = await request(app)
      .put(`/restaurants/00000000-0000-0000-0000-000000000000/categories/${cid}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });

  test('DELETE category → 200, deleted = true', async () => {
    const res = await request(app)
      .delete(`/restaurants/${rid}/categories/${cid}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  test('DELETE already-deleted category → 404', async () => {
    const res = await request(app)
      .delete(`/restaurants/${rid}/categories/${cid}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ─── Admin: menu items ────────────────────────────────────────────────────────

describe('Menu items', () => {
  let rid: string;
  let cid: string;
  let itemId: string;

  beforeAll(async () => {
    const restRes = await request(app)
      .post('/restaurants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...SAMPLE_RESTAURANT, name: 'Items Test Restaurant' });
    rid = restRes.body.restaurant.id;

    const catRes = await request(app)
      .post(`/restaurants/${rid}/categories`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Mains', display_order: 0 });
    cid = catRes.body.category.id;
  });

  test('POST /restaurants/:id/items → 201', async () => {
    const res = await request(app)
      .post(`/restaurants/${rid}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category_id:  cid,
        name:         'Chicken Burger',
        description:  'Crispy chicken with lettuce',
        price_cents:  895,
      });

    expect(res.status).toBe(201);
    expect(res.body.item.name).toBe('Chicken Burger');
    expect(res.body.item.price_cents).toBe(895);
    expect(res.body.item.available).toBe(true);
    itemId = res.body.item.id;
  });

  test('missing required field (price_cents) → 400', async () => {
    const res = await request(app)
      .post(`/restaurants/${rid}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category_id: cid, name: 'No Price Item' });
    expect(res.status).toBe(400);
  });

  test('negative price_cents → 400', async () => {
    const res = await request(app)
      .post(`/restaurants/${rid}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category_id: cid, name: 'Negative', price_cents: -1 });
    expect(res.status).toBe(400);
  });

  test('non-integer price_cents → 400', async () => {
    const res = await request(app)
      .post(`/restaurants/${rid}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category_id: cid, name: 'Float Price', price_cents: 4.99 });
    expect(res.status).toBe(400);
  });

  test('category from different restaurant → 404', async () => {
    const res = await request(app)
      .post(`/restaurants/${rid}/items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category_id:  '00000000-0000-0000-0000-000000000000',
        name:         'Bad Cat',
        price_cents:  100,
      });
    expect(res.status).toBe(404);
  });

  test('PUT /restaurants/menu-items/:id → 200', async () => {
    const res = await request(app)
      .put(`/restaurants/menu-items/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Spicy Chicken Burger', price_cents: 950 });

    expect(res.status).toBe(200);
    expect(res.body.item.name).toBe('Spicy Chicken Burger');
    expect(res.body.item.price_cents).toBe(950);
  });

  test('PUT unknown item → 404', async () => {
    const res = await request(app)
      .put('/restaurants/menu-items/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });

  test('PATCH availability → 200, available = false', async () => {
    const res = await request(app)
      .patch(`/restaurants/menu-items/${itemId}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ available: false });

    expect(res.status).toBe(200);
    expect(res.body.item.available).toBe(false);
  });

  test('PATCH availability → 200, available = true', async () => {
    const res = await request(app)
      .patch(`/restaurants/menu-items/${itemId}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ available: true });

    expect(res.status).toBe(200);
    expect(res.body.item.available).toBe(true);
  });

  test('PATCH availability with non-boolean → 400', async () => {
    const res = await request(app)
      .patch(`/restaurants/menu-items/${itemId}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ available: 'yes' });
    expect(res.status).toBe(400);
  });

  test('DELETE menu item → 200, deleted = true', async () => {
    const res = await request(app)
      .delete(`/restaurants/menu-items/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  test('DELETE already-deleted item → 404', async () => {
    const res = await request(app)
      .delete(`/restaurants/menu-items/${itemId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('non-admin on item routes → 403', async () => {
    const res = await request(app)
      .post(`/restaurants/${rid}/items`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ category_id: cid, name: 'Hack', price_cents: 100 });
    expect(res.status).toBe(403);
  });
});
