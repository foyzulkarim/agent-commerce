import { type Pool, query } from "@ac/db";
import { defineTool, GuardError } from "@ac/mcp-kit";
import { z } from "zod";

export type Address = { line1: string; city: string; postcode: string };

export async function findCustomer(pool: Pool, customerId: string) {
  const result = await query<{
    customer_id: string;
    name: string;
    card_ref: string;
    line1: string | null;
    city: string | null;
    postcode: string | null;
  }>(
    pool,
    `SELECT c.customer_id, c.name, c.card_ref, a.line1, a.city, a.postcode
       FROM customers c LEFT JOIN addresses a ON a.customer_id = c.customer_id AND a.is_default
      WHERE c.customer_id = $1`,
    [customerId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const default_address: Address | null = row.line1
    ? { line1: row.line1, city: row.city ?? "", postcode: row.postcode ?? "" }
    : null;
  return { customer_id: row.customer_id, name: row.name, card_ref: row.card_ref, default_address };
}

/** Customers tools (design §6). Read only. Called by code in other servers, not by agents. */
export function customersTools(pool: Pool) {
  const CustomerId = z.object({ customer_id: z.string().min(1) });

  const getCustomer = defineTool({
    name: "get_customer",
    description: "Returns the customer: name, card reference and default delivery address.",
    input: CustomerId,
    run: async ({ customer_id }) => {
      const customer = await findCustomer(pool, customer_id);
      if (!customer) throw new GuardError(`unknown customer ${customer_id}`);
      return customer;
    },
  });

  const getCustomerEmail = defineTool({
    name: "get_customer_email",
    description: "Returns the email address of the customer. Only the email server calls it.",
    input: CustomerId,
    run: async ({ customer_id }) => {
      const result = await query<{ email: string }>(
        pool,
        "SELECT email FROM customers WHERE customer_id = $1",
        [customer_id],
      );
      const row = result.rows[0];
      if (!row) throw new GuardError(`unknown customer ${customer_id}`);
      return { customer_id, email: row.email };
    },
  });

  return [getCustomer, getCustomerEmail];
}
