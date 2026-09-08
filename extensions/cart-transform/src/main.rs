// Gift Cart Transform Function
// Makes gift product (with _gift attribute) free (price = 0)
// if the cart total meets the threshold requirement.

use serde::{Deserialize, Serialize};
use shopify_function::prelude::*;

#[derive(Serialize, Deserialize, Debug, Clone)]
struct CartLine {
    id: String,
    merchandise: Merchandise,
    attributes: Vec<Attribute>,
    cost: Cost,
    quantity: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct Merchandise {
    id: String,
    product: Product,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct Product {
    id: String,
    title: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct Attribute {
    key: String,
    value: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct Cost {
    amount_per_quantity: Amount,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct Amount {
    amount: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct Cart {
    lines: Vec<CartLine>,
    cost: CartCost,
}

#[derive(Serialize, Deserialize, Debug)]
struct CartCost {
    subtotal_amount: Amount,
    total_amount: Amount,
}

#[shopify_function]
fn function(input: Cart) -> shopify_function::Result<Output> {
    // Find the gift line (has _gift attribute = "true")
    let gift_line = input.cart.lines.iter().find(|line| {
        line.attributes.iter().any(|attr| attr.key == "_gift" && attr.value == "true")
    });

    let operations: Vec<Operation> = if let Some(gift) = gift_line {
        // Calculate threshold base: total minus gift price
        let gift_price: f64 = gift.cost.amount_per_quantity.amount.parse().unwrap_or(0.0);
        let cart_total: f64 = input.cart.cost.total_amount.amount.parse().unwrap_or(0.0);
        let threshold_base = cart_total - (gift_price * gift.quantity as f64);

        // Find the active tier (from metafield or hardcoded for now)
        // In production, this would read from app metafields
        let tiers = get_tiers();
        let active_tier = tiers.iter()
            .filter(|t| t.min_amount <= threshold_base)
            .max_by_key(|t| t.min_amount);

        if let Some(tier) = active_tier {
            let max_gift_price = tier.gift_amount as f64 / 100.0;
            if gift_price <= max_gift_price {
                // Make the gift free
                vec![Operation::UpdateCartLine(CartLineUpdate {
                    id: gift.id.clone(),
                    price: Some(MoneyInput {
                        amount: "0".to_string(),
                    }),
                })]
            } else {
                // Gift too expensive — remove it
                vec![Operation::UpdateCartLine(CartLineUpdate {
                    id: gift.id.clone(),
                    quantity: Some(0),
                })]
            }
        } else {
            // No active tier — remove gift
            vec![Operation::UpdateCartLine(CartLineUpdate {
                id: gift.id.clone(),
                quantity: Some(0),
            })]
        }
    } else {
        // No gift in cart — no operations
        vec![]
    };

    Ok(Output { operations })
}

struct Tier {
    min_amount: f64,  // in euros
    gift_amount: i64, // in cents
}

fn get_tiers() -> Vec<Tier> {
    // In production, these would be read from app metafields
    // For now, use the Davines preset
    vec![
        Tier { min_amount: 50.0, gift_amount: 300 },
        Tier { min_amount: 60.0, gift_amount: 300 },
        Tier { min_amount: 70.0, gift_amount: 400 },
        Tier { min_amount: 80.0, gift_amount: 500 },
        Tier { min_amount: 90.0, gift_amount: 600 },
        Tier { min_amount: 100.0, gift_amount: 800 },
        Tier { min_amount: 110.0, gift_amount: 900 },
        Tier { min_amount: 120.0, gift_amount: 1000 },
        Tier { min_amount: 130.0, gift_amount: 1200 },
        Tier { min_amount: 140.0, gift_amount: 1300 },
        Tier { min_amount: 150.0, gift_amount: 1500 },
        Tier { min_amount: 160.0, gift_amount: 1700 },
        Tier { min_amount: 170.0, gift_amount: 1900 },
        Tier { min_amount: 180.0, gift_amount: 2100 },
        Tier { min_amount: 190.0, gift_amount: 2300 },
        Tier { min_amount: 200.0, gift_amount: 2500 },
        Tier { min_amount: 210.0, gift_amount: 2700 },
        Tier { min_amount: 220.0, gift_amount: 3000 },
        Tier { min_amount: 230.0, gift_amount: 3200 },
        Tier { min_amount: 240.0, gift_amount: 3500 },
        Tier { min_amount: 250.0, gift_amount: 3800 },
        Tier { min_amount: 260.0, gift_amount: 4000 },
        Tier { min_amount: 270.0, gift_amount: 4300 },
        Tier { min_amount: 280.0, gift_amount: 4600 },
        Tier { min_amount: 290.0, gift_amount: 4900 },
        Tier { min_amount: 300.0, gift_amount: 5300 },
        Tier { min_amount: 320.0, gift_amount: 5800 },
        Tier { min_amount: 330.0, gift_amount: 6100 },
        Tier { min_amount: 340.0, gift_amount: 6500 },
        Tier { min_amount: 350.0, gift_amount: 6800 },
        Tier { min_amount: 360.0, gift_amount: 7200 },
        Tier { min_amount: 370.0, gift_amount: 7600 },
        Tier { min_amount: 380.0, gift_amount: 8000 },
        Tier { min_amount: 390.0, gift_amount: 8400 },
        Tier { min_amount: 400.0, gift_amount: 8800 },
        Tier { min_amount: 410.0, gift_amount: 9200 },
        Tier { min_amount: 420.0, gift_amount: 9700 },
        Tier { min_amount: 430.0, gift_amount: 10100 },
        Tier { min_amount: 440.0, gift_amount: 10600 },
        Tier { min_amount: 450.0, gift_amount: 11000 },
        Tier { min_amount: 460.0, gift_amount: 11500 },
        Tier { min_amount: 470.0, gift_amount: 12000 },
        Tier { min_amount: 480.0, gift_amount: 12500 },
        Tier { min_amount: 490.0, gift_amount: 13000 },
        Tier { min_amount: 500.0, gift_amount: 13500 },
        Tier { min_amount: 510.0, gift_amount: 14000 },
        Tier { min_amount: 520.0, gift_amount: 14600 },
        Tier { min_amount: 530.0, gift_amount: 15100 },
        Tier { min_amount: 540.0, gift_amount: 15700 },
        Tier { min_amount: 550.0, gift_amount: 16200 },
        Tier { min_amount: 560.0, gift_amount: 16800 },
        Tier { min_amount: 570.0, gift_amount: 17400 },
        Tier { min_amount: 580.0, gift_amount: 18000 },
        Tier { min_amount: 590.0, gift_amount: 18600 },
        Tier { min_amount: 600.0, gift_amount: 19200 },
        Tier { min_amount: 610.0, gift_amount: 19800 },
        Tier { min_amount: 620.0, gift_amount: 20500 },
    ]
}
