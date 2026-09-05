import PDFDocument from 'pdfkit/js/pdfkit.standalone.js';
import type { Row } from './db.js';
const money = (n: number) =>
  `INR ${(n / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function documentPdf(record: Row, kind: string): Promise<Blob> {
  const doc = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true });
  // pdfkit's document is a readable stream; collecting its chunks avoids pulling
  // blob-stream's Node 'stream' dependency into the browser bundle.
  const chunks: BlobPart[] = [];
  const done = new Promise<Blob>((resolve, reject) => {
    doc.on('data', (chunk: Uint8Array) => chunks.push(new Uint8Array(chunk)));
    doc.on('end', () => resolve(new Blob(chunks, { type: 'application/pdf' })));
    doc.on('error', reject);
  });
  const green = '#143c2e',
    muted = '#65736b';
  const heading = () => {
    doc.rect(0, 0, 596, 12).fill(green);
    doc.fillColor(green).font('Helvetica-Bold').fontSize(23).text('HORECA YARD', 44, 40);
    doc.fontSize(10).fillColor(muted).text('YOUR WHOLESALE PARTNER', 44, 70);
    doc
      .fillColor(green)
      .fontSize(18)
      .text(kind === 'invoices' ? 'TAX INVOICE' : 'QUOTATION', 340, 43, {
        width: 210,
        align: 'right',
      });
    doc.fontSize(10).text(record.reference, 340, 70, { width: 210, align: 'right' });
  };
  heading();
  let y = 108;
  const block = (label: string, value: string, x: number, width: number) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(muted).text(label, x, y, { width });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(green)
      .text(value, x, y + 17, { width });
    return doc.y;
  };
  const s = record.seller,
    c = record.customer;
  const sy = block(
    'FROM',
    `${s.businessName}\n${s.address || 'Address pending configuration'}\n${s.gstin ? 'GSTIN: ' + s.gstin : ''}\n${s.phone}`,
    44,
    238,
  );
  const states: Record<string, string> = {
    '01': 'Jammu and Kashmir',
    '02': 'Himachal Pradesh',
    '03': 'Punjab',
    '04': 'Chandigarh',
    '05': 'Uttarakhand',
    '06': 'Haryana',
    '07': 'Delhi',
    '08': 'Rajasthan',
    '09': 'Uttar Pradesh',
    '10': 'Bihar',
    '11': 'Sikkim',
    '12': 'Arunachal Pradesh',
    '13': 'Nagaland',
    '14': 'Manipur',
    '15': 'Mizoram',
    '16': 'Tripura',
    '17': 'Meghalaya',
    '18': 'Assam',
    '19': 'West Bengal',
    '20': 'Jharkhand',
    '21': 'Odisha',
    '22': 'Chhattisgarh',
    '23': 'Madhya Pradesh',
    '24': 'Gujarat',
    '26': 'Dadra and Nagar Haveli and Daman and Diu',
    '27': 'Maharashtra',
    '29': 'Karnataka',
    '30': 'Goa',
    '31': 'Lakshadweep',
    '32': 'Kerala',
    '33': 'Tamil Nadu',
    '34': 'Puducherry',
    '35': 'Andaman and Nicobar Islands',
    '36': 'Telangana',
    '37': 'Andhra Pradesh',
    '38': 'Ladakh',
  };
  const cy = block(
    'BILL / DELIVER TO',
    `${c.business}\n${c.name}\n${c.address || 'Address not provided'}\n${c.gstin ? 'GSTIN: ' + c.gstin : 'Unregistered customer'}\nPlace of supply: ${states[c.stateCode] || 'Not specified'} ${c.stateCode || ''}`,
    310,
    240,
  );
  y = Math.max(sy, cy) + 25;
  doc
    .fontSize(10)
    .text(
      `Date: ${new Date(record.issuedAt || record.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}${kind === 'quotes' ? '     Valid until: ' + record.validUntil : ''}`,
      44,
      y,
    );
  y += 28;
  const header = () => {
    doc.rect(44, y, 507, 25).fill(green);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(9);
    doc.text('PRODUCT / HSN', 52, y + 8, { width: 185 });
    doc.text('PKTS', 240, y + 8);
    doc.text('RATE', 282, y + 8);
    doc.text('DISC.', 350, y + 8);
    doc.text('GST', 399, y + 8);
    doc.text('AMOUNT', 462, y + 8);
    y += 34;
  };
  if (y > 650) {
    doc.addPage();
    heading();
    y = 108;
  }
  header();
  for (const item of record.items) {
    doc.font('Helvetica').fontSize(9);
    const label = `${item.name}\n${item.packSize} | HSN ${item.hsn || 'pending'}`;
    const height = Math.max(48, doc.heightOfString(label, { width: 180 }) + 18);
    if (y + height > 705) {
      doc.addPage();
      heading();
      y = 108;
      header();
    }
    doc.fillColor(green).text(label, 52, y, { width: 180 });
    doc.text(String(item.quantity), 240, y, { width: 38 });
    doc.text(item.rate.toFixed(2), 282, y, { width: 65 });
    doc.text(`${item.discount}%`, 350, y, { width: 40 });
    doc.text(`${item.taxRate}%`, 399, y, { width: 40 });
    doc.text(money(item.amount), 446, y, { width: 99, align: 'right' });
    doc
      .moveTo(44, y + height - 9)
      .lineTo(551, y + height - 9)
      .strokeColor('#e2e6df')
      .stroke();
    y += height;
  }
  if (y > 470) {
    doc.addPage();
    heading();
    y = 110;
  }
  y += 15;
  const totalLine = (label: string, value: number, bold = false) => {
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 13 : 10)
      .fillColor(green)
      .text(label, 290, y, { width: 155 });
    doc.text(money(value), 435, y, { width: 110, align: 'right' });
    y += 23;
  };
  totalLine('Taxable products', record.taxable);
  totalLine('Delivery (before tax)', record.deliveryAmount);
  if (kind === 'invoices') {
    if (record.igst) totalLine('IGST', record.igst);
    else {
      totalLine('CGST', record.cgst);
      totalLine('SGST', record.sgst);
    }
  } else totalLine('Total tax', record.tax);
  totalLine('TOTAL', record.total, true);
  y += 15;
  const notes = `Delivery GST: ${record.deliveryTaxRate}%\n${kind === 'invoices' ? 'Reverse charge: No | Original for recipient\n' : ''}${record.notes || ''}\n${s.invoiceTerms || ''}\n${kind === 'invoices' ? s.bankDetails || '' : ''}`;
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  let chunk = '';
  for (const word of notes.split(/\s+/)) {
    const candidate = chunk ? chunk + ' ' + word : word;
    if (doc.heightOfString(candidate, { width: 507 }) > 650 - y) {
      doc.text(chunk, 44, y, { width: 507 });
      doc.addPage();
      heading();
      y = 108;
      doc.font('Helvetica').fontSize(9).fillColor(muted);
      chunk = word;
    } else chunk = candidate;
  }
  if (chunk) {
    doc.text(chunk, 44, y, { width: 507 });
    y = doc.y + 35;
  }
  if (kind === 'invoices') {
    if (y > 705) {
      doc.addPage();
      heading();
      y = 115;
    }
    doc
      .moveTo(365, y + 20)
      .lineTo(551, y + 20)
      .strokeColor('#b6c1b4')
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(muted)
      .text('Authorised signatory', 365, y + 28, { width: 186, align: 'right' });
  }
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc
      .fontSize(8)
      .fillColor(muted)
      .text(`${record.reference}   |   ${i + 1} / ${pages.count}`, 44, 785, {
        width: 507,
        align: 'center',
        lineBreak: false,
      });
  }
  doc.end();
  return done;
}
