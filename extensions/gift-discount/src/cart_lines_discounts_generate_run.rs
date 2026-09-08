use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;

const TIERS: &[(i64, i64)] = &[
    (5000, 300), (6000, 300), (7000, 400), (8000, 500), (9000, 600),
    (10000, 800), (11000, 900), (12000, 1000), (13000, 1200), (14000, 1300),
    (15000, 1500), (16000, 1700), (17000, 1900), (18000, 2100), (19000, 2300),
    (20000, 2500), (21000, 2700), (22000, 3000), (23000, 3200), (24000, 3500),
    (25000, 3800), (26000, 4000), (27000, 4300), (28000, 4600), (29000, 4900),
    (30000, 5300), (32000, 5800), (33000, 6100), (34000, 6500), (35000, 6800),
    (36000, 7200), (37000, 7600), (38000, 8000), (39000, 8400), (40000, 8800),
    (41000, 9200), (42000, 9700), (43000, 10100), (44000, 10600), (45000, 11000),
    (46000, 11500), (47000, 12000), (48000, 12500), (49000, 13000), (50000, 13500),
    (51000, 14000), (52000, 14600), (53000, 15100), (54000, 15700), (55000, 16200),
    (56000, 16800), (57000, 17400), (58000, 18000), (59000, 18600), (60000, 19200),
    (61000, 19800), (62000, 20500),
];

fn cents(value: &Decimal) -> i64 {
    (value.to_string().parse::<f64>().unwrap_or(0.0) * 100.0).round() as i64
}

#[shopify_function]
fn cart_lines_discounts_generate_run(
    input: schema::cart_lines_discounts_generate_run::Input,
) -> Result<schema::CartLinesDiscountsGenerateRunResult> {
    let has_product_discount_class = input
        .discount()
        .discount_classes()
        .contains(&schema::DiscountClass::Product);

    if !has_product_discount_class {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    // Check if the cart contains exactly one selected gift line.
    let gift_lines = input
        .cart()
        .lines()
        .iter()
        .filter(|line| {
            line.gift()
                .is_some_and(|attribute| attribute.value().is_some_and(|value| value == "true"))
        })
        .collect::<Vec<_>>();

    if gift_lines.len() != 1 || *gift_lines[0].quantity() != 1 {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    let qualifying_total = input
        .cart()
        .lines()
        .iter()
        .filter(|line| {
            line.gift()
                .is_none_or(|attribute| attribute.value().is_none_or(|value| value != "true"))
        })
        .map(|line| cents(line.cost().subtotal_amount().amount()))
        .sum::<i64>();

    let max_gift_price = TIERS
        .iter()
        .filter(|(minimum, _)| *minimum <= qualifying_total)
        .map(|(_, gift_amount)| *gift_amount)
        .max();

    let gift_line = gift_lines[0];
    let gift_price = cents(gift_line.cost().amount_per_quantity().amount());

    if max_gift_price.is_none_or(|maximum| gift_price <= 0 || gift_price > maximum) {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    // Check if the selected gift qualifies for a complete product discount.
    Ok(schema::CartLinesDiscountsGenerateRunResult {
        operations: vec![schema::CartOperation::ProductDiscountsAdd(
            schema::ProductDiscountsAddOperation {
                selection_strategy: schema::ProductDiscountSelectionStrategy::First,
                candidates: vec![schema::ProductDiscountCandidate {
                    targets: vec![schema::ProductDiscountCandidateTarget::CartLine(
                        schema::CartLineTarget {
                            id: gift_line.id().clone(),
                            quantity: Some(1),
                        },
                    )],
                    message: Some("Free gift".to_string()),
                    value: schema::ProductDiscountCandidateValue::Percentage(schema::Percentage {
                        value: Decimal(100.0),
                    }),
                    associated_discount_code: None,
                    prerequisites: None,
                }],
            },
        )],
    })
}
