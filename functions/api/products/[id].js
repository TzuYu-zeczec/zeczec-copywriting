import { getProduct, updateProduct, deleteProduct } from '../../_shared/sheets.js';

export async function onRequestGet({ params, env }) {
  try {
    const product = await getProduct(env, params.id);
    if (!product) return Response.json({ error: '找不到產品' }, { status: 404 });
    return Response.json({ product });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestPut({ params, request, env }) {
  try {
    const body = await request.json();
    const product = await updateProduct(env, params.id, body);
    return Response.json({ product });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestDelete({ params, env }) {
  try {
    await deleteProduct(env, params.id);
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
