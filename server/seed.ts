import { Database, list, save } from './db.js';
export const categories = [
  'Frozen Foods',
  'Sauces & Dressings',
  'Ready-to-Cook Gravies',
  'Dairy & Cheese',
  'Frozen Desserts',
  'Disposables',
];
export const catalogue = [
  ['Cheesy Mayonnaise', 'Veeba', 1, '1 kg', '1 carton (12 pouches)', 12, 'mayo'],
  ['Crinkle Fries 9mm', 'McCain', 0, '2.5 kg', '1 carton (4 bags)', 4, 'fries'],
  ['Eggless Mayonnaise (Professional)', 'Veeba', 1, '1 kg', '1 carton (12 pouches)', 12, 'mayo'],
  ['French Fries (Regular 9mm)', 'McCain', 0, '2.5 kg', '1 carton (4 bags)', 4, 'fries'],
  ['Herb Potato Patty', 'Hungritos', 0, '1 kg', '5 packs', 5, 'patty'],
  ['Potato Smiles', 'Hungritos', 0, '1 kg', '5 packs', 5, 'smiles'],
  ['Shoestring French Fries Gold', 'Hungritos', 0, '2.5 kg', '1 carton (4 bags)', 4, 'fries'],
  ['Smiles (Crispy Happy Potatoes)', 'McCain', 0, '2.5 kg', '1 carton (4 bags)', 4, 'smiles'],
  ['Southwest Chipotle Sauce', 'Veeba', 1, '1 kg', '6 bottles', 6, 'sauce'],
  ['Spicy Paneer Patty', 'ITC Master Chef', 0, '12 pieces', '1 carton', 1, 'patty'],
  ['Tomato Ketchup', 'Funfoods (Dr. Oetker)', 1, '1.1 kg', '6 bottles', 6, 'sauce'],
  ['Veggie Pizza Pocket', 'ITC Master Chef', 0, '26 pieces', '1 carton', 1, 'pocket'],
];
export async function seed(db: Database) {
  await db.transaction(async (tx) => {
    if ((await list(tx, 'settings')).length) return;
    for (const name of categories) await save(tx, 'categories', { name, active: true });
    for (const name of [
      'Veeba',
      'McCain',
      'Hungritos',
      'ITC Master Chef',
      'Funfoods (Dr. Oetker)',
      'Amul',
      'English Oven',
    ])
      await save(tx, 'brands', { name, active: true });
    const images = [
      'veeba-cheesy-mayo',
      'mccain-crinkle',
      'veeba-eggless-mayo',
      'mccain-french-fries',
      'hungritos-herb-patty',
      'hungritos-potato-smiles',
      'hungritos-shoestring',
      'mccain-smiles',
      'veeba-chipotle',
      'itc-paneer-patty',
      'funfoods-ketchup',
      'itc-pizza-pocket',
    ];
    for (const [i, p] of catalogue.entries())
      await save(tx, 'products', {
        name: p[0],
        brand: p[1],
        category: categories[Number(p[2])],
        packSize: p[3],
        moq: p[4],
        minQuantity: p[5],
        image: `/images/${images[i]}.jpg`,
        description: `${p[0]} from ${p[1]}, supplied in wholesale quantities for professional kitchens. Contact us to confirm current availability and your bulk rate.`,
        published: true,
        featured: [0, 3, 6, 11].includes(i),
        availability: 'On request',
        lowStockThreshold: 0,
        hsn: '',
      });
    await save(
      tx,
      'settings',
      {
        businessName: 'Horeca Yard',
        phone: '9818180167',
        instagram: 'https://www.instagram.com/horecayard/',
        heroTitle: 'PREMIUM HORECA PRODUCTS AT WHOLESALE PRICES.',
        heroDescription:
          'McCain, Veeba, ITC Master Chef, Hungritos & more — genuine brands, factory-direct bulk rates, delivered cold-chain safe to your restaurant, café, hotel or cloud kitchen.',
        address: '',
        gstin: '',
        stateCode: '',
        email: '',
        invoiceTerms: 'Payment and delivery as agreed in your quotation.',
        bankDetails: '',
        warehouseName: 'Main warehouse',
      },
      'business-settings',
    );
  });
}
