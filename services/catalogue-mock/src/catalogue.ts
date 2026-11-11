import { type Pool, type PoolClient, query } from "@ac/db";

export type Product = {
  sku: string;
  name: string;
  description: string;
  unit_price: number;
  stock: number;
  reserved: number;
  available: number;
};

const SELECT_PRODUCTS = `
  SELECT p.sku, p.name, p.description, p.unit_price,
         COALESCE(s.quantity, 0) AS stock,
         COALESCE((SELECT sum(r.quantity) FROM reservations r WHERE r.sku = p.sku), 0)::int AS reserved
    FROM products p LEFT JOIN stock s ON s.sku = p.sku`;

function withAvailable(rows: Omit<Product, "available">[]): Product[] {
  return rows.map((r) => ({ ...r, available: Math.max(0, r.stock - r.reserved) }));
}

export async function listProducts(db: Pool | PoolClient): Promise<Product[]> {
  const result = await query<Omit<Product, "available">>(db, `${SELECT_PRODUCTS} ORDER BY p.sku`);
  return withAvailable(result.rows);
}

export async function getProducts(db: Pool | PoolClient, skus: string[]): Promise<Product[]> {
  const result = await query<Omit<Product, "available">>(
    db,
    `${SELECT_PRODUCTS} WHERE p.sku = ANY($1) ORDER BY p.sku`,
    [skus],
  );
  return withAvailable(result.rows);
}

/** Every word must appear in the SKU, the name or the description. An empty query lists all. */
export async function searchProducts(db: Pool | PoolClient, text: string): Promise<Product[]> {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9-]/g, ""))
    .filter((w) => w.length > 1);
  const all = await listProducts(db);
  return all.filter((p) => {
    const hay = `${p.sku} ${p.name} ${p.description}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
