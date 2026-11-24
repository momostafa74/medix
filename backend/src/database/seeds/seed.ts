/* eslint-disable no-console */
/**
 * Seed script — loads only the data the app needs to run (no demo/mock data).
 *   npm run seed                → roles/permissions, super admin, subscription plans,
 *                                 locations, specialties, commission rule, medicine catalog
 *   npm run seed -- --reset     → wipe ALL tables then seed (dev only!)
 *   npm run seed -- --rbac-only → roles/permissions, subscription plans + super admin only
 *
 * In production SEED_ADMIN_PASSWORD (and ideally SEED_ADMIN_EMAIL / SEED_ADMIN_PHONE) must be set.
 */
import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager, In } from 'typeorm';
import { dataSourceOptions } from '../data-source';
import {
  Area,
  City,
  CommissionRule,
  CommissionScope,
  Country,
  Coupon,
  DiscountType,
  Governorate,
  Medicine,
  Permission,
  ProviderType,
  Role,
  RoleCode,
  Specialty,
  SubscriptionPlan,
  User,
} from '../entities';
import { ALL_PERMISSIONS, ROLE_NAMES, ROLE_PERMISSIONS } from '../../common/permissions';

const args = new Set(process.argv.slice(2));

export async function seedRbac(m: EntityManager) {
  for (const code of ALL_PERMISSIONS) {
    await m.upsert(Permission, { code, module: code.split('.')[0] }, ['code']);
  }
  const perms = await m.find(Permission);
  for (const code of Object.values(RoleCode)) {
    await m.upsert(Role, { code, nameAr: ROLE_NAMES[code].ar, nameEn: ROLE_NAMES[code].en, isSystem: true }, ['code']);
    const role = await m.findOneOrFail(Role, { where: { code }, relations: { permissions: true } });
    role.permissions = perms.filter((p) => (ROLE_PERMISSIONS[code] as string[]).includes(p.code));
    await m.save(role);
  }
  if (process.env.NODE_ENV !== 'test') console.log(`✓ ${perms.length} permissions, ${Object.values(RoleCode).length} roles`);
}

export async function ensureUser(m: EntityManager, data: { fullName: string; phone: string; email: string; password: string; roles: RoleCode[] }) {
  let u = await m.findOne(User, { where: { phone: data.phone } });
  if (u) return u;
  const roles = await m.find(Role, { where: { code: In(data.roles) } });
  u = await m.save(
    m.create(User, {
      fullName: data.fullName,
      phone: data.phone,
      email: data.email,
      passwordHash: await bcrypt.hash(data.password, 10),
      roles,
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    }),
  );
  return u;
}

export async function seedSuperAdmin(m: EntityManager) {
  const u = await ensureUser(m, {
    fullName: process.env.SEED_ADMIN_NAME || 'مدير النظام',
    phone: process.env.SEED_ADMIN_PHONE || '+201000000001',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@medix.local',
    password: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345',
    roles: [RoleCode.SUPER_ADMIN],
  });
  if (process.env.NODE_ENV !== 'test') console.log(`✓ super admin ${u.email}`);
}

const LOCATIONS: Record<string, { en: string; cities: Record<string, { en: string; areas: [string, string][] }> }> = {
  القاهرة: {
    en: 'Cairo',
    cities: {
      'مدينة نصر': { en: 'Nasr City', areas: [['الحي السابع', '7th District'], ['عباس العقاد', 'Abbas El Akkad'], ['مكرم عبيد', 'Makram Ebeid']] },
      'مصر الجديدة': { en: 'Heliopolis', areas: [['الكوربة', 'Korba'], ['روكسي', 'Roxy'], ['ميدان الجامع', 'El Gamea Square']] },
      المعادي: { en: 'Maadi', areas: [['دجلة', 'Degla'], ['المعادي الجديدة', 'New Maadi'], ['زهراء المعادي', 'Zahraa El Maadi']] },
      'التجمع الخامس': { en: 'Fifth Settlement', areas: [['التسعين الشمالي', 'North 90th'], ['البنفسج', 'El Banafseg'], ['اللوتس', 'El Lotus']] },
    },
  },
  الجيزة: {
    en: 'Giza',
    cities: {
      الدقي: { en: 'Dokki', areas: [['شارع التحرير', 'Tahrir St'], ['ميدان المساحة', 'Messaha Square']] },
      المهندسين: { en: 'Mohandessin', areas: [['شارع جامعة الدول', 'Gameat El Dewal'], ['شارع شهاب', 'Shehab St']] },
      'الشيخ زايد': { en: 'Sheikh Zayed', areas: [['الحي الأول', 'District 1'], ['بيفرلي هيلز', 'Beverly Hills']] },
    },
  },
  الإسكندرية: {
    en: 'Alexandria',
    cities: {
      سموحة: { en: 'Smouha', areas: [['شارع فوزي معاذ', 'Fawzy Moaz'], ['شارع النصر', 'El Nasr St']] },
      'سيدي جابر': { en: 'Sidi Gaber', areas: [['المحطة', 'Station'], ['شارع المشير', 'El Moshir St']] },
    },
  },
  الفيوم: {
    en: 'Fayoum',
    cities: {
      'مدينة الفيوم': { en: 'Fayoum City', areas: [['الحادقة', 'El Hadka'], ['المسلة', 'El Masala'], ['الصوفي', 'El Sofi']] },
      إبشواي: { en: 'Ibshway', areas: [['وسط البلد', 'Downtown']] },
    },
  },
  الدقهلية: { en: 'Dakahlia', cities: { المنصورة: { en: 'Mansoura', areas: [['حي الجامعة', 'University District'], ['توريل', 'Toriel']] } } },
};

const SPECIALTIES: [string, string, string, string][] = [
  ['الباطنة', 'Internal Medicine', 'internal-medicine', 'stethoscope'],
  ['القلب والأوعية الدموية', 'Cardiology', 'cardiology', 'favorite'],
  ['الأسنان', 'Dentistry', 'dentistry', 'mood'],
  ['الجلدية', 'Dermatology', 'dermatology', 'face'],
  ['الأطفال وحديثي الولادة', 'Pediatrics', 'pediatrics', 'child_care'],
  ['العظام', 'Orthopedics', 'orthopedics', 'accessibility'],
  ['المخ والأعصاب', 'Neurology', 'neurology', 'psychology'],
  ['الرمد', 'Ophthalmology', 'ophthalmology', 'visibility'],
  ['النساء والتوليد', 'Obstetrics & Gynecology', 'obgyn', 'pregnant_woman'],
  ['الأنف والأذن والحنجرة', 'ENT', 'ent', 'hearing'],
  ['المسالك البولية', 'Urology', 'urology', 'water_drop'],
  ['الطب النفسي', 'Psychiatry', 'psychiatry', 'self_improvement'],
  ['التغذية', 'Nutrition', 'nutrition', 'restaurant'],
  ['الأورام', 'Oncology', 'oncology', 'health_and_safety'],
];

export async function seedReference(m: EntityManager) {
  let eg = await m.findOneBy(Country, { code: 'EG' });
  if (!eg) eg = await m.save(m.create(Country, { code: 'EG', nameAr: 'مصر', nameEn: 'Egypt' }));
  for (const [govAr, gov] of Object.entries(LOCATIONS)) {
    await m.upsert(Governorate, { countryId: eg.id, nameAr: govAr, nameEn: gov.en }, ['countryId', 'nameEn']);
    const g = await m.findOneByOrFail(Governorate, { countryId: eg.id, nameEn: gov.en });
    for (const [cityAr, city] of Object.entries(gov.cities)) {
      await m.upsert(City, { governorateId: g.id, nameAr: cityAr, nameEn: city.en }, ['governorateId', 'nameEn']);
      const c = await m.findOneByOrFail(City, { governorateId: g.id, nameEn: city.en });
      for (const [aAr, aEn] of city.areas) await m.upsert(Area, { cityId: c.id, nameAr: aAr, nameEn: aEn }, ['cityId', 'nameEn']);
    }
  }
  let i = 0;
  for (const [ar, en, slug, icon] of SPECIALTIES) {
    await m.upsert(Specialty, { nameAr: ar, nameEn: en, slug, icon, sortOrder: i++, description: `تخصص ${ar}` }, ['slug']);
  }
  const card = await m.findOneByOrFail(Specialty, { slug: 'cardiology' });
  const dent = await m.findOneByOrFail(Specialty, { slug: 'dentistry' });
  for (const [ar, en, slug, parentId] of [
    ['قسطرة القلب', 'Interventional Cardiology', 'interventional-cardiology', card.id],
    ['تقويم الأسنان', 'Orthodontics', 'orthodontics', dent.id],
    ['زراعة الأسنان', 'Dental Implants', 'dental-implants', dent.id],
  ]) {
    await m.upsert(Specialty, { nameAr: ar, nameEn: en, slug, parentId, sortOrder: 100 }, ['slug']);
  }
  if (!(await m.exists(CommissionRule, { where: { scope: CommissionScope.GLOBAL } }))) {
    await m.save(m.create(CommissionRule, { scope: CommissionScope.GLOBAL, type: DiscountType.PERCENTAGE, value: 10 }));
  }
  await m.upsert(Coupon, { code: 'WELCOME20', description: 'خصم 20% على أول حجز', type: DiscountType.PERCENTAGE, value: 20, maxDiscount: 200, usageLimit: 1000, perUserLimit: 1 }, ['code']);
  await seedPlans(m);
  if (process.env.NODE_ENV !== 'test') console.log('✓ locations, specialties, commission rule, coupon, subscription plans');
}


// [nameEn, nameAr, generic, form, strength, category, rx, kind, manufacturer]
type MedSeed = [string, string, string | null, string | null, string | null, string, boolean, 'MEDICINE' | 'PRODUCT', string | null];
const MEDICINES: MedSeed[] = [
  ['Panadol Extra', 'بنادول إكسترا', 'Paracetamol + Caffeine', 'Tablets', '500mg/65mg', 'مسكنات وخافض حرارة', false, 'MEDICINE', 'GSK'],
  ['Panadol Advance', 'بنادول أدفانس', 'Paracetamol', 'Tablets', '500mg', 'مسكنات وخافض حرارة', false, 'MEDICINE', 'GSK'],
  ['Abimol', 'أبيمول', 'Paracetamol', 'Tablets', '500mg', 'مسكنات وخافض حرارة', false, 'MEDICINE', 'Glaxo Egypt'],
  ['Brufen', 'بروفين', 'Ibuprofen', 'Tablets', '400mg', 'مسكنات وخافض حرارة', false, 'MEDICINE', 'Abbott'],
  ['Cataflam', 'كتافلام', 'Diclofenac potassium', 'Tablets', '50mg', 'مسكنات وخافض حرارة', false, 'MEDICINE', 'Novartis'],
  ['Augmentin 1g', 'أوجمنتين 1 جم', 'Amoxicillin/Clavulanate', 'Tablets', '1g', 'مضادات حيوية', true, 'MEDICINE', 'GSK'],
  ['Hibiotic', 'هاي بيوتك', 'Amoxicillin/Clavulanate', 'Tablets', '1g', 'مضادات حيوية', true, 'MEDICINE', 'Amoun'],
  ['Zithromax', 'زيثروماكس', 'Azithromycin', 'Capsules', '500mg', 'مضادات حيوية', true, 'MEDICINE', 'Pfizer'],
  ['Ciprobay', 'سيبروباي', 'Ciprofloxacin', 'Tablets', '500mg', 'مضادات حيوية', true, 'MEDICINE', 'Bayer'],
  ['Concor 5mg', 'كونكور 5 مجم', 'Bisoprolol', 'Tablets', '5mg', 'القلب والضغط', true, 'MEDICINE', 'Merck'],
  ['Aspirin Protect', 'أسبرين بروتكت', 'Acetylsalicylic acid', 'Tablets', '100mg', 'القلب والضغط', false, 'MEDICINE', 'Bayer'],
  ['Ator 20', 'أتور 20', 'Atorvastatin', 'Tablets', '20mg', 'القلب والضغط', true, 'MEDICINE', 'EIPICO'],
  ['Lipitor', 'ليبيتور', 'Atorvastatin', 'Tablets', '20mg', 'القلب والضغط', true, 'MEDICINE', 'Pfizer'],
  ['Norvasc', 'نورفاسك', 'Amlodipine', 'Tablets', '5mg', 'القلب والضغط', true, 'MEDICINE', 'Pfizer'],
  ['Capoten', 'كابوتين', 'Captopril', 'Tablets', '25mg', 'القلب والضغط', true, 'MEDICINE', 'BMS'],
  ['Glucophage 500', 'جلوكوفاج 500', 'Metformin', 'Tablets', '500mg', 'السكر', true, 'MEDICINE', 'Merck'],
  ['Cidophage 850', 'سيدوفاج 850', 'Metformin', 'Tablets', '850mg', 'السكر', true, 'MEDICINE', 'CID'],
  ['Amaryl 2mg', 'أماريل 2 مجم', 'Glimepiride', 'Tablets', '2mg', 'السكر', true, 'MEDICINE', 'Sanofi'],
  ['Nexium 40', 'نيكسيوم 40', 'Esomeprazole', 'Tablets', '40mg', 'الجهاز الهضمي', true, 'MEDICINE', 'AstraZeneca'],
  ['Antinal', 'أنتينال', 'Nifuroxazide', 'Capsules', '200mg', 'الجهاز الهضمي', false, 'MEDICINE', 'Amoun'],
  ['Motilium', 'موتيليوم', 'Domperidone', 'Tablets', '10mg', 'الجهاز الهضمي', false, 'MEDICINE', 'Janssen'],
  ['Gaviscon', 'جافيسكون', 'Sodium alginate', 'Oral suspension', '150ml', 'الجهاز الهضمي', false, 'MEDICINE', 'Reckitt'],
  ['Claritine', 'كلاريتين', 'Loratadine', 'Tablets', '10mg', 'الحساسية والبرد', false, 'MEDICINE', 'Bayer'],
  ['Telfast 180', 'تلفاست 180', 'Fexofenadine', 'Tablets', '180mg', 'الحساسية والبرد', false, 'MEDICINE', 'Sanofi'],
  ['Comtrex', 'كومتركس', 'Paracetamol + Pseudoephedrine + Chlorpheniramine', 'Tablets', null, 'الحساسية والبرد', false, 'MEDICINE', 'BMS'],
  ['Otrivin Adult', 'أوتريفين للكبار', 'Xylometazoline', 'Nasal spray', '0.1%', 'الحساسية والبرد', false, 'MEDICINE', 'Novartis'],
  ['Ventolin Inhaler', 'فنتولين بخاخ', 'Salbutamol', 'Inhaler', '100mcg', 'الصدر والجهاز التنفسي', true, 'MEDICINE', 'GSK'],
  ['Mucosolvan Syrup', 'ميوكوسولفان شراب', 'Ambroxol', 'Syrup', '15mg/5ml', 'الصدر والجهاز التنفسي', false, 'MEDICINE', 'Boehringer'],
  ['Fucidin Cream', 'فيوسيدين كريم', 'Fusidic acid', 'Cream', '2%', 'الجلدية', false, 'MEDICINE', 'LEO'],
  ['Betnovate Cream', 'بيتنوفيت كريم', 'Betamethasone', 'Cream', '0.1%', 'الجلدية', true, 'MEDICINE', 'GSK'],
  ['Eltroxin 50', 'التروكسين 50', 'Levothyroxine', 'Tablets', '50mcg', 'الغدد', true, 'MEDICINE', 'Aspen'],
  ['Vitamin C 1000', 'فيتامين سي 1000', 'Ascorbic acid', 'Effervescent tablets', '1000mg', 'فيتامينات ومكملات', false, 'MEDICINE', 'Bayer'],
  ['Centrum Adults', 'سنتروم للكبار', 'Multivitamin', 'Tablets', null, 'فيتامينات ومكملات', false, 'PRODUCT', 'Pfizer'],
  ['Omega 3 Plus', 'أوميجا 3 بلس', 'Fish oil', 'Softgels', '1000mg', 'فيتامينات ومكملات', false, 'PRODUCT', 'Pharco'],
  ['Vitamin D3 Drops', 'فيتامين د3 نقط', 'Cholecalciferol', 'Drops', '400IU', 'فيتامينات ومكملات', false, 'MEDICINE', 'Hi Pharm'],
  ['La Roche-Posay Anthelios SPF50', 'واقي شمس لاروش بوزيه SPF50', null, 'Cream', '50ml', 'العناية بالبشرة', false, 'PRODUCT', 'La Roche-Posay'],
  ['CeraVe Moisturising Cream', 'كريم سيرافي المرطب', null, 'Cream', '340g', 'العناية بالبشرة', false, 'PRODUCT', 'CeraVe'],
  ['Bioderma Sensibio H2O', 'مزيل مكياج بيوديرما', null, 'Micellar water', '250ml', 'العناية بالبشرة', false, 'PRODUCT', 'Bioderma'],
  ['Pampers Premium Care Size 4', 'حفاضات بامبرز بريميوم مقاس 4', null, null, '52 pcs', 'الأم والطفل', false, 'PRODUCT', 'P&G'],
  ['Bebelac 1', 'بيبيلاك 1 لبن أطفال', null, 'Powder', '400g', 'الأم والطفل', false, 'PRODUCT', 'Nutricia'],
  ['Accu-Chek Active Strips', 'شرائط قياس السكر أكيو تشيك', null, null, '50 strips', 'أجهزة ومستلزمات طبية', false, 'PRODUCT', 'Roche'],
  ['Omron M2 Blood Pressure Monitor', 'جهاز ضغط أومرون M2', null, null, null, 'أجهزة ومستلزمات طبية', false, 'PRODUCT', 'Omron'],
  ['Digital Thermometer', 'ترمومتر ديجيتال', null, null, null, 'أجهزة ومستلزمات طبية', false, 'PRODUCT', 'Microlife'],
  ['Face Masks 50 pcs', 'كمامات طبية 50 قطعة', null, null, '50 pcs', 'أجهزة ومستلزمات طبية', false, 'PRODUCT', null],
  ['Signal Toothpaste Herbal', 'معجون أسنان سيجنال أعشاب', null, 'Toothpaste', '100ml', 'العناية الشخصية', false, 'PRODUCT', 'Unilever'],
];
// price at Al-Hayah, price at Roshdy (null = not listed), quantity at Al-Hayah (null = untracked)

/** Shared medicine & product catalog that pharmacies pick from (idempotent). */
export async function seedMedicines(m: EntityManager) {
  for (const [nameEn, nameAr, generic, form, strength, category, rx, kind, manufacturer] of MEDICINES) {
    const data = { nameEn, nameAr, genericName: generic, form, strength, category, requiresPrescription: rx, kind, manufacturer };
    const existing = await m.findOne(Medicine, { where: { nameEn } });
    if (existing) await m.update(Medicine, existing.id, data);
    else await m.save(m.create(Medicine, data));
  }
  if (process.env.NODE_ENV !== 'test') console.log(`✓ ${MEDICINES.length} medicines & products`);
}

// [code, type, name, price, days, default, features]
const PLANS: [string, ProviderType, string, number, number, boolean, string[]][] = [
  ['DOCTOR_MONTHLY', ProviderType.DOCTOR, 'باقة الطبيب الشهرية', 300, 30, true, ['ظهور في نتائج البحث', 'حجوزات بلا حدود', 'روشتات إلكترونية', 'شات مع المرضى']],
  ['DOCTOR_QUARTERLY', ProviderType.DOCTOR, 'باقة الطبيب — 3 شهور', 800, 90, false, ['كل مزايا الباقة الشهرية', 'توفير 100 ج.م']],
  ['LAB_MONTHLY', ProviderType.LABORATORY, 'باقة المعمل الشهرية', 600, 30, true, ['كتالوج تحاليل وباقات', 'حجز في الفرع وسحب منزلي', 'تقارير PDF برمز QR', 'حسابات لفريق العمل']],
  ['RADIOLOGY_MONTHLY', ProviderType.RADIOLOGY, 'باقة مركز الأشعة الشهرية', 800, 30, true, ['حجز حسب الأجهزة', 'تقارير PDF برمز QR', 'قائمة عمل DICOM', 'حسابات لفريق العمل']],
  ['PHARMACY_MONTHLY', ProviderType.PHARMACY, 'باقة الصيدلية الشهرية', 400, 30, true, ['متجر أونلاين', 'طلبات توصيل واستلام', 'التحقق من الروشتات', 'إدارة المخزون']],
  ['HOSPITAL_MONTHLY', ProviderType.HOSPITAL, 'باقة المستشفى الشهرية', 1500, 30, true, ['كل الخدمات']],
  ['HOME_CARE_MONTHLY', ProviderType.HOME_CARE, 'باقة الرعاية المنزلية', 400, 30, true, ['طلبات زيارة منزلية']],
];

export async function seedPlans(m: EntityManager) {
  for (const [i, [code, providerType, nameAr, price, durationDays, isDefault, features]] of PLANS.entries()) {
    if (!(await m.exists(SubscriptionPlan, { where: { code } }))) {
      await m.save(m.create(SubscriptionPlan, { code, providerType, nameAr, price, durationDays, isDefault, features, sortOrder: i }));
    }
  }
}

async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && !process.env.SEED_ADMIN_PASSWORD) throw new Error('Set SEED_ADMIN_PASSWORD before seeding production');
  const ds = new DataSource(dataSourceOptions());
  await ds.initialize();
  try {
    if (args.has('--reset')) {
      if (isProd) throw new Error('--reset is disabled in production');
      const tables: { tablename: string }[] = await ds.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'migrations'`);
      await ds.query(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
      console.log('✓ database wiped');
    }
    await ds.transaction(async (m) => {
      await seedRbac(m);
      await seedSuperAdmin(m);
      // Subscription plans are reference data the app cannot run without (idempotent, production-safe).
      await seedPlans(m);
    });
    if (args.has('--rbac-only')) return;
    await ds.transaction(async (m) => {
      await seedReference(m);
      await seedMedicines(m);
    });
    console.log('\nDone.');
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
