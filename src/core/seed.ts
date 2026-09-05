export const categories = [
  'Frozen Foods',
  'Sauces & Dressings',
  'Ready-to-Cook Gravies',
  'Dairy & Cheese',
  'Frozen Desserts',
  'Disposables',
];
export const brands = [
  'Veeba',
  'McCain',
  'Hungritos',
  'ITC Master Chef',
  'Funfoods (Dr. Oetker)',
  'Amul',
  'English Oven',
];
export const catalogue = [
  ['Cheesy Mayonnaise', 'Veeba', 1, '1 kg', '1 carton (12 pouches)', 12, 'veeba-cheesy-mayo'],
  ['Crinkle Fries 9mm', 'McCain', 0, '2.5 kg', '1 carton (4 bags)', 4, 'mccain-crinkle'],
  ['Eggless Mayonnaise (Professional)', 'Veeba', 1, '1 kg', '1 carton (12 pouches)', 12, 'veeba-eggless-mayo'],
  ['French Fries (Regular 9mm)', 'McCain', 0, '2.5 kg', '1 carton (4 bags)', 4, 'mccain-french-fries'],
  ['Herb Potato Patty', 'Hungritos', 0, '1 kg', '5 packs', 5, 'hungritos-herb-patty'],
  ['Potato Smiles', 'Hungritos', 0, '1 kg', '5 packs', 5, 'hungritos-potato-smiles'],
  ['Shoestring French Fries Gold', 'Hungritos', 0, '2.5 kg', '1 carton (4 bags)', 4, 'hungritos-shoestring'],
  ['Smiles (Crispy Happy Potatoes)', 'McCain', 0, '2.5 kg', '1 carton (4 bags)', 4, 'mccain-smiles'],
  ['Southwest Chipotle Sauce', 'Veeba', 1, '1 kg', '6 bottles', 6, 'veeba-chipotle'],
  ['Spicy Paneer Patty', 'ITC Master Chef', 0, '12 pieces', '1 carton', 1, 'itc-paneer-patty'],
  ['Tomato Ketchup', 'Funfoods (Dr. Oetker)', 1, '1.1 kg', '6 bottles', 6, 'funfoods-ketchup'],
  ['Veggie Pizza Pocket', 'ITC Master Chef', 0, '26 pieces', '1 carton', 1, 'itc-pizza-pocket'],
] as const;

export const settings = {
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
};

/** The seed records, as plain documents keyed by collection. */
export function seedRecords(uuid: () => string) {
  const at = new Date().toISOString();
  const stamp = (data: any, id = uuid()) => ({ ...data, id, updatedAt: at, _createdAt: at });
  return {
    categories: categories.map((name) => stamp({ name, active: true })),
    brands: brands.map((name) => stamp({ name, active: true })),
    products: catalogue.map((p, i) =>
      stamp({
        name: p[0],
        brand: p[1],
        category: categories[Number(p[2])],
        packSize: p[3],
        moq: p[4],
        minQuantity: p[5],
        image: `/images/${p[6]}.jpg`,
        description: `${p[0]} from ${p[1]}, supplied in wholesale quantities for professional kitchens. Contact us to confirm current availability and your bulk rate.`,
        published: true,
        featured: [0, 3, 6, 11].includes(i),
        availability: 'On request',
        lowStockThreshold: 0,
        hsn: '',
      }),
    ),
    settings: [stamp(settings, 'business-settings')],
  };
}
