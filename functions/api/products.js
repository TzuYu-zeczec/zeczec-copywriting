/**
 * /api/products — Products CRUD
 * GET    /api/products       → list all
 * POST   /api/products       → create new
 * GET    /api/products/:id   → get one (handled by [[id]].js)
 * PUT    /api/products/:id   → update (handled by [[id]].js)
 * DELETE /api/products/:id   → delete (handled by [[id]].js)
 */
import { listProducts, createProduct } from '../_shared/sheets.js';

export async function onRequestGet({ env }) {
  try {
    const products = await listProducts(env);
    return Response.json({ products });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    // Get user email from Cloudflare Access JWT (if available)
    const userEmail = request.headers.get('cf-access-authenticated-user-email') || '';
    const product = await createProduct(env, body, userEmail);
    return Response.json({ product }, { status: 201 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
