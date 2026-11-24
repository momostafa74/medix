import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Alert, Box, CircularProgress } from '@mui/material';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import EventNoteOutlined from '@mui/icons-material/EventNoteOutlined';
import FavoriteBorder from '@mui/icons-material/FavoriteBorder';
import FolderSharedOutlined from '@mui/icons-material/FolderSharedOutlined';
import NotificationsOutlined from '@mui/icons-material/NotificationsOutlined';
import PersonOutline from '@mui/icons-material/PersonOutline';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import StarOutline from '@mui/icons-material/StarOutline';
import InsightsOutlined from '@mui/icons-material/InsightsOutlined';
import BadgeOutlined from '@mui/icons-material/BadgeOutlined';
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined';
import MedicalServicesOutlined from '@mui/icons-material/MedicalServicesOutlined';
import CategoryOutlined from '@mui/icons-material/CategoryOutlined';
import ManageAccountsOutlined from '@mui/icons-material/ManageAccountsOutlined';
import RateReviewOutlined from '@mui/icons-material/RateReviewOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import ChatBubbleOutline from '@mui/icons-material/ChatBubbleOutline';
import BiotechOutlined from '@mui/icons-material/BiotechOutlined';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import ListAltOutlined from '@mui/icons-material/ListAltOutlined';
import EventAvailableOutlined from '@mui/icons-material/EventAvailableOutlined';
import BadgeGroup from '@mui/icons-material/Groups2Outlined';
import MonitorHeartOutlined from '@mui/icons-material/MonitorHeartOutlined';
import SettingsInputComponentOutlined from '@mui/icons-material/SettingsInputComponentOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import LocalPharmacyOutlined from '@mui/icons-material/LocalPharmacyOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import QrCodeScanner from '@mui/icons-material/QrCodeScanner';
import LocalShippingOutlined from '@mui/icons-material/LocalShippingOutlined';
import MedicationOutlined from '@mui/icons-material/MedicationOutlined';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import WorkspacePremiumOutlined from '@mui/icons-material/WorkspacePremiumOutlined';
import AccountBalanceWalletOutlined from '@mui/icons-material/AccountBalanceWalletOutlined';
import LocalOfferOutlined from '@mui/icons-material/LocalOfferOutlined';
import PercentOutlined from '@mui/icons-material/PercentOutlined';
import QueryStatsOutlined from '@mui/icons-material/QueryStatsOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import MonitorHeartOutlinedIcon from '@mui/icons-material/SpeedOutlined';
import { useAuth } from './auth/AuthProvider';
import RequireAuth from './auth/RequireAuth';
import { ConfirmProvider } from './components/common';
import PublicLayout from './layouts/PublicLayout';
import DashboardLayout from './layouts/DashboardLayout';
import { useMyProvider, VerificationBanner } from './components/ProviderManagement';
import { CartProvider } from './components/pharmacy/Cart';
import CompleteNameDialog from './components/CompleteNameDialog';
import { SubscriptionBanner } from './components/payments/SubscriptionBanner';

// Route-level code splitting
const Home = lazy(() => import('./pages/public/Home'));
const Doctors = lazy(() => import('./pages/public/Doctors'));
const DoctorProfile = lazy(() => import('./pages/public/DoctorProfile'));
const Specialties = lazy(() => import('./pages/public/Specialties'));
const Providers = lazy(() => import('./pages/public/Providers'));
const ProviderProfile = lazy(() => import('./pages/public/ProviderProfile'));
const Emergency = lazy(() => import('./pages/public/Emergency'));
const auth = () => import('./pages/public/AuthPages');
const Login = lazy(() => auth().then((m) => ({ default: m.Login })));
const Register = lazy(() => auth().then((m) => ({ default: m.Register })));
const RegisterDoctor = lazy(() => auth().then((m) => ({ default: m.RegisterDoctor })));
const ForgotPassword = lazy(() => auth().then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => auth().then((m) => ({ default: m.ResetPassword })));
const VerifyEmail = lazy(() => auth().then((m) => ({ default: m.VerifyEmail })));
const NotFound = lazy(() => auth().then((m) => ({ default: m.NotFound })));
const RegisterProvider = lazy(() => auth().then((m) => ({ default: m.RegisterProvider })));
const LabTests = lazy(() => import('./pages/public/LabTests'));
const LabBooking = lazy(() => import('./pages/public/LabBooking'));
const Verify = lazy(() => import('./pages/public/Verify'));
const rb = () => import('./pages/public/RadiologyBooking');
const RadiologyBooking = lazy(rb);
const RadiologyServicesSearch = lazy(() => rb().then((m) => ({ default: m.RadiologyServicesSearch })));

const ph = () => import('./pages/public/Pharmacy');
const MedicinesSearch = lazy(() => ph().then((m) => ({ default: m.MedicinesSearch })));
const MedicineDetail = lazy(() => ph().then((m) => ({ default: m.MedicineDetail })));
const Checkout = lazy(() => ph().then((m) => ({ default: m.Checkout })));

const pay = () => import('./pages/public/Payment');
const SandboxCheckout = lazy(() => pay().then((m) => ({ default: m.SandboxCheckout })));
const PaymentResult = lazy(() => pay().then((m) => ({ default: m.PaymentResult })));
const PatientPayments = lazy(() => import('./pages/patient/PatientPayments').then((m) => ({ default: m.PatientPayments })));
const sub = () => import('./pages/provider/Subscription');
const SubscriptionPage = lazy(() => sub().then((m) => ({ default: m.SubscriptionPage })));
const EarningsPage = lazy(() => sub().then((m) => ({ default: m.EarningsPage })));
const af = () => import('./pages/admin/AdminFinance');
const AdminFinanceDashboard = lazy(() => af().then((m) => ({ default: m.AdminFinanceDashboard })));
const AdminPayments = lazy(() => af().then((m) => ({ default: m.AdminPayments })));
const AdminSubscriptions = lazy(() => af().then((m) => ({ default: m.AdminSubscriptions })));
const AdminCoupons = lazy(() => af().then((m) => ({ default: m.AdminCoupons })));
const AdminCommissions = lazy(() => af().then((m) => ({ default: m.AdminCommissions })));

const NotificationsPage = lazy(() => import('./pages/shared/Notifications'));
const SettingsPage = lazy(() => import('./pages/shared/Settings'));

const pat = () => import('./pages/patient/PatientPages');
const PatientDashboard = lazy(() => pat().then((m) => ({ default: m.PatientDashboard })));
const PatientAppointments = lazy(() => pat().then((m) => ({ default: m.PatientAppointments })));
const PatientFavorites = lazy(() => pat().then((m) => ({ default: m.PatientFavorites })));
const MedicalRecord = lazy(() => import('./pages/patient/MedicalRecord'));
const plo = () => import('./pages/patient/PatientLabOrders');
const PatientLabOrders = lazy(() => plo().then((m) => ({ default: m.PatientLabOrders })));
const PatientLabOrderDetail = lazy(() => plo().then((m) => ({ default: m.PatientLabOrderDetail })));
const prad = () => import('./pages/patient/PatientRadiology');
const PatientRadiology = lazy(() => prad().then((m) => ({ default: m.PatientRadiology })));
const PatientRadiologyDetail = lazy(() => prad().then((m) => ({ default: m.PatientRadiologyDetail })));
const PatientProfile = lazy(() => import('./pages/patient/PatientProfile'));
const pph = () => import('./pages/patient/PatientPharmacy');
const PatientPrescriptions = lazy(() => pph().then((m) => ({ default: m.PatientPrescriptions })));
const PatientPrescriptionDetail = lazy(() => pph().then((m) => ({ default: m.PatientPrescriptionDetail })));
const PatientPharmacyOrders = lazy(() => pph().then((m) => ({ default: m.PatientPharmacyOrders })));
const PatientPharmacyOrderDetail = lazy(() => pph().then((m) => ({ default: m.PatientPharmacyOrderDetail })));

const DoctorDashboard = lazy(() => import('./pages/doctor/DoctorDashboard'));
const DoctorReports = lazy(() => import('./pages/doctor/DoctorDashboard').then((m) => ({ default: m.DoctorReports })));
const SchedulePage = lazy(() => import('./pages/doctor/Schedule'));
const DoctorProfileEdit = lazy(() => import('./pages/doctor/DoctorProfileEdit'));
const ReviewsPage = lazy(() => import('./pages/doctor/Reviews'));
const pts = () => import('./pages/doctor/Patients');
const PatientsList = lazy(() => pts().then((m) => ({ default: m.PatientsList })));
const PatientDetail = lazy(() => pts().then((m) => ({ default: m.PatientDetail })));
const AppointmentsManager = lazy(() => import('./components/AppointmentsManager'));
const drx = () => import('./pages/doctor/Prescriptions');
const DoctorPrescriptions = lazy(() => drx().then((m) => ({ default: m.DoctorPrescriptions })));
const DoctorPrescriptionDetail = lazy(() => drx().then((m) => ({ default: m.DoctorPrescriptionDetail })));

const ProviderHome = lazy(() => import('./pages/provider/ProviderHome'));
const ChatPage = lazy(() => import('./pages/chat/ChatPage'));
const LabDashboard = lazy(() => import('./pages/lab/LabDashboard'));
const LabOrdersBoard = lazy(() => import('./pages/lab/LabOrdersBoard'));
const LabOrderWork = lazy(() => import('./pages/lab/LabOrderWork'));
const LabCatalog = lazy(() => import('./pages/lab/LabCatalog'));
const LabTeam = lazy(() => import('./pages/lab/LabTeam'));
const LabSettings = lazy(() => import('./pages/lab/LabSettings'));
const AdminLabOrders = lazy(() => import('./pages/admin/AdminLabOrders').then((m) => ({ default: m.AdminLabOrders })));
const AdminRadiologyOrders = lazy(() => import('./pages/admin/AdminLabOrders').then((m) => ({ default: m.AdminRadiologyOrders })));
const RadDashboard = lazy(() => import('./pages/radiology/RadDashboard'));
const RadOrdersBoard = lazy(() => import('./pages/radiology/RadOrdersBoard'));
const RadOrderWork = lazy(() => import('./pages/radiology/RadOrderWork'));
const RadServices = lazy(() => import('./pages/radiology/RadServices'));
const RadSettings = lazy(() => import('./pages/radiology/RadSettings'));
const PhDashboard = lazy(() => import('./pages/pharmacy/PhDashboard'));
const PhOrdersBoard = lazy(() => import('./pages/pharmacy/PhOrdersBoard'));
const PhOrderWork = lazy(() => import('./pages/pharmacy/PhOrderWork'));
const PhInventory = lazy(() => import('./pages/pharmacy/PhInventory'));
const PhVerify = lazy(() => import('./pages/pharmacy/PhVerify'));
const PhSettings = lazy(() => import('./pages/pharmacy/PhSettings'));
const aph = () => import('./pages/admin/AdminPharmacy');
const AdminPharmacyOrders = lazy(() => aph().then((m) => ({ default: m.AdminPharmacyOrders })));
const AdminMedicines = lazy(() => aph().then((m) => ({ default: m.AdminMedicines })));

const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminReports = lazy(() => import('./pages/admin/AdminDashboard').then((m) => ({ default: m.AdminReports })));
const ap = () => import('./pages/admin/AdminProviders');
const AdminProviders = lazy(() => ap().then((m) => ({ default: m.AdminProviders })));
const AdminProviderDetail = lazy(() => ap().then((m) => ({ default: m.AdminProviderDetail })));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const am = () => import('./pages/admin/AdminMisc');
const AdminAppointments = lazy(() => am().then((m) => ({ default: m.AdminAppointments })));
const AdminSpecialties = lazy(() => am().then((m) => ({ default: m.AdminSpecialties })));
const AdminReviews = lazy(() => am().then((m) => ({ default: m.AdminReviews })));
const ops = () => import('./pages/admin/AdminOps');
const AdminAudit = lazy(() => ops().then((m) => ({ default: m.AdminAudit })));
const AdminSecurity = lazy(() => ops().then((m) => ({ default: m.AdminSecurity })));
const AdminSystemHealth = lazy(() => ops().then((m) => ({ default: m.AdminSystemHealth })));
const AnalyticsPage = lazy(() => import('./pages/shared/Analytics'));
const AdminSettings = lazy(() => am().then((m) => ({ default: m.AdminSettings })));

const PageHeaderLazy = lazy(() => import('./components/common').then((m) => ({ default: m.PageHeader })));

const PATIENT_NAV = [
  { to: '/patient', label: 'الرئيسية', icon: <DashboardOutlined />, end: true },
  { to: '/patient/appointments', label: 'مواعيدي', icon: <EventNoteOutlined /> },
  { to: '/patient/lab-orders', label: 'تحاليلي', icon: <BiotechOutlined /> },
  { to: '/patient/radiology', label: 'الأشعة', icon: <MonitorHeartOutlined /> },
  { to: '/patient/prescriptions', label: 'روشتاتي', icon: <ReceiptLongOutlined /> },
  { to: '/patient/pharmacy-orders', label: 'طلبات الصيدلية', icon: <LocalShippingOutlined /> },
  { to: '/patient/payments', label: 'مدفوعاتي', icon: <PaymentsOutlined /> },
  { to: '/patient/chat', label: 'الرسائل', icon: <ChatBubbleOutline />, badge: 'chat' },
  { to: '/doctors', label: 'ابحث عن طبيب', icon: <SearchOutlined /> },
  { to: '/patient/medical-record', label: 'سجلي الطبي', icon: <FolderSharedOutlined /> },
  { to: '/patient/favorites', label: 'المفضلة', icon: <FavoriteBorder /> },
  { to: '/patient/notifications', label: 'الإشعارات', icon: <NotificationsOutlined /> },
  { to: '/patient/profile', label: 'بياناتي', icon: <PersonOutline /> },
  { to: '/patient/settings', label: 'الإعدادات', icon: <SettingsOutlined /> },
];

const DOCTOR_NAV = [
  { to: '/doctor', label: 'لوحة التحكم', icon: <DashboardOutlined />, end: true },
  { to: '/doctor/appointments', label: 'المواعيد', icon: <EventNoteOutlined /> },
  { to: '/doctor/patients', label: 'المرضى', icon: <GroupsOutlined /> },
  { to: '/doctor/prescriptions', label: 'الروشتات', icon: <ReceiptLongOutlined /> },
  { to: '/doctor/chat', label: 'الرسائل', icon: <ChatBubbleOutline />, badge: 'chat' },
  { to: '/doctor/schedule', label: 'جدول المواعيد', icon: <CalendarMonthOutlined /> },
  { to: '/doctor/reports', label: 'التقارير', icon: <InsightsOutlined /> },
  { to: '/doctor/analytics', label: 'تحليلات الأداء', icon: <QueryStatsOutlined /> },
  { to: '/doctor/reviews', label: 'التقييمات', icon: <StarOutline /> },
  { to: '/doctor/earnings', label: 'الإيرادات', icon: <AccountBalanceWalletOutlined />, perm: 'payments.read.provider' },
  { to: '/doctor/subscription', label: 'الاشتراك', icon: <WorkspacePremiumOutlined /> },
  { to: '/doctor/profile', label: 'ملفي', icon: <BadgeOutlined /> },
  { to: '/doctor/notifications', label: 'الإشعارات', icon: <NotificationsOutlined /> },
  { to: '/doctor/settings', label: 'الإعدادات', icon: <SettingsOutlined /> },
];

const PROVIDER_NAV = [
  { to: '/provider', label: 'الملف والفروع', icon: <ScienceOutlined />, end: true },
  { to: '/provider/earnings', label: 'الإيرادات', icon: <AccountBalanceWalletOutlined />, perm: 'payments.read.provider' },
  { to: '/provider/subscription', label: 'الاشتراك', icon: <WorkspacePremiumOutlined /> },
  { to: '/provider/chat', label: 'الرسائل', icon: <ChatBubbleOutline />, badge: 'chat' },
  { to: '/provider/notifications', label: 'الإشعارات', icon: <NotificationsOutlined /> },
  { to: '/provider/settings', label: 'الإعدادات', icon: <SettingsOutlined /> },
];

const LAB_NAV = [
  { to: '/provider/lab', label: 'لوحة المعمل', icon: <DashboardOutlined />, end: true },
  { to: '/provider/orders', label: 'الطلبات', icon: <AssignmentOutlined /> },
  { to: '/provider/catalog', label: 'التحاليل والباقات', icon: <ListAltOutlined /> },
  { to: '/provider/chat', label: 'الرسائل', icon: <ChatBubbleOutline />, badge: 'chat' },
  { to: '/provider/lab-settings', label: 'إعدادات الحجز', icon: <EventAvailableOutlined />, group: 'المعمل' },
  { to: '/provider/team', label: 'فريق العمل', icon: <BadgeGroup />, perm: 'provider.manage.own', group: 'المعمل' },
  { to: '/provider/earnings', label: 'الإيرادات', icon: <AccountBalanceWalletOutlined />, perm: 'payments.read.provider', group: 'المعمل' },
  { to: '/provider/analytics', label: 'تحليلات الأداء', icon: <QueryStatsOutlined />, perm: 'dashboard.provider', group: 'المعمل' },
  { to: '/provider/subscription', label: 'الاشتراك', icon: <WorkspacePremiumOutlined />, group: 'المعمل' },
  { to: '/provider', label: 'الملف والفروع', icon: <ScienceOutlined />, end: true, group: 'المعمل' },
  { to: '/provider/notifications', label: 'الإشعارات', icon: <NotificationsOutlined />, group: 'المعمل' },
  { to: '/provider/settings', label: 'الإعدادات', icon: <SettingsOutlined />, group: 'المعمل' },
];

const RAD_NAV = [
  { to: '/provider/radiology', label: 'لوحة المركز', icon: <DashboardOutlined />, end: true },
  { to: '/provider/bookings', label: 'الحجوزات', icon: <AssignmentOutlined /> },
  { to: '/provider/services', label: 'الخدمات والأسعار', icon: <ListAltOutlined /> },
  { to: '/provider/chat', label: 'الرسائل', icon: <ChatBubbleOutline />, badge: 'chat' },
  { to: '/provider/radiology-settings', label: 'الفروع والأجهزة', icon: <SettingsInputComponentOutlined />, group: 'المركز' },
  { to: '/provider/team', label: 'فريق العمل', icon: <BadgeGroup />, perm: 'provider.manage.own', group: 'المركز' },
  { to: '/provider/earnings', label: 'الإيرادات', icon: <AccountBalanceWalletOutlined />, perm: 'payments.read.provider', group: 'المركز' },
  { to: '/provider/analytics', label: 'تحليلات الأداء', icon: <QueryStatsOutlined />, perm: 'dashboard.provider', group: 'المركز' },
  { to: '/provider/subscription', label: 'الاشتراك', icon: <WorkspacePremiumOutlined />, group: 'المركز' },
  { to: '/provider', label: 'الملف والفروع', icon: <ScienceOutlined />, end: true, group: 'المركز' },
  { to: '/provider/notifications', label: 'الإشعارات', icon: <NotificationsOutlined />, group: 'المركز' },
  { to: '/provider/settings', label: 'الإعدادات', icon: <SettingsOutlined />, group: 'المركز' },
];

const PH_NAV = [
  { to: '/provider/pharmacy', label: 'لوحة الصيدلية', icon: <DashboardOutlined />, end: true },
  { to: '/provider/pharmacy-orders', label: 'الطلبات', icon: <AssignmentOutlined /> },
  { to: '/provider/rx-verify', label: 'التحقق من روشتة', icon: <QrCodeScanner />, perm: 'prescriptions.verify' },
  { to: '/provider/inventory', label: 'الأدوية والمخزون', icon: <Inventory2Outlined /> },
  { to: '/provider/chat', label: 'الرسائل', icon: <ChatBubbleOutline />, badge: 'chat' },
  { to: '/provider/pharmacy-settings', label: 'التوصيل والمواعيد', icon: <LocalShippingOutlined />, group: 'الصيدلية' },
  { to: '/provider/team', label: 'فريق العمل', icon: <BadgeGroup />, perm: 'provider.manage.own', group: 'الصيدلية' },
  { to: '/provider/earnings', label: 'الإيرادات', icon: <AccountBalanceWalletOutlined />, perm: 'payments.read.provider', group: 'الصيدلية' },
  { to: '/provider/analytics', label: 'تحليلات الأداء', icon: <QueryStatsOutlined />, perm: 'dashboard.provider', group: 'الصيدلية' },
  { to: '/provider/subscription', label: 'الاشتراك', icon: <WorkspacePremiumOutlined />, group: 'الصيدلية' },
  { to: '/provider', label: 'الملف والفروع', icon: <LocalPharmacyOutlined />, end: true, group: 'الصيدلية' },
  { to: '/provider/notifications', label: 'الإشعارات', icon: <NotificationsOutlined />, group: 'الصيدلية' },
  { to: '/provider/settings', label: 'الإعدادات', icon: <SettingsOutlined />, group: 'الصيدلية' },
];

const ADMIN_NAV = [
  { to: '/admin', label: 'لوحة الإدارة', icon: <DashboardOutlined />, end: true, perm: 'dashboard.admin' },
  { to: '/admin/providers', label: 'اعتماد مقدمي الخدمة', icon: <StorefrontOutlined />, perm: 'providers.read.any', group: 'مقدمو الخدمة' },
  { to: '/admin/doctors', label: 'الأطباء', icon: <MedicalServicesOutlined />, perm: 'providers.read.any', group: 'مقدمو الخدمة' },
  { to: '/admin/specialties', label: 'التخصصات', icon: <CategoryOutlined />, perm: 'specialties.manage', group: 'مقدمو الخدمة' },
  { to: '/admin/appointments', label: 'المواعيد', icon: <EventNoteOutlined />, perm: 'appointments.read.any', group: 'التشغيل' },
  { to: '/admin/lab-orders', label: 'طلبات التحاليل', icon: <BiotechOutlined />, perm: 'lab.orders.read.any', group: 'التشغيل' },
  { to: '/admin/radiology-orders', label: 'حجوزات الأشعة', icon: <MonitorHeartOutlined />, perm: 'radiology.orders.read.any', group: 'التشغيل' },
  { to: '/admin/pharmacy-orders', label: 'طلبات الصيدليات', icon: <LocalPharmacyOutlined />, perm: 'pharmacy.orders.read.any', group: 'التشغيل' },
  { to: '/admin/medicines', label: 'دليل الأدوية', icon: <MedicationOutlined />, perm: 'medicines.manage', group: 'مقدمو الخدمة' },
  { to: '/admin/patients', label: 'المرضى', icon: <GroupsOutlined />, perm: 'users.read', group: 'التشغيل' },
  { to: '/admin/chat', label: 'الرسائل والدعم', icon: <ChatBubbleOutline />, perm: 'chat.support', badge: 'chat', group: 'التشغيل' },
  { to: '/admin/reviews', label: 'التقييمات', icon: <RateReviewOutlined />, perm: 'reviews.moderate', group: 'التشغيل' },
  { to: '/admin/reports', label: 'التقارير', icon: <InsightsOutlined />, perm: 'reports.read.any', group: 'التشغيل' },
  { to: '/admin/finance', label: 'نظرة مالية', icon: <InsightsOutlined />, perm: 'finance.read', group: 'المالية' },
  { to: '/admin/payments', label: 'المدفوعات', icon: <PaymentsOutlined />, perm: 'finance.read', group: 'المالية' },
  { to: '/admin/subscriptions', label: 'الاشتراكات', icon: <WorkspacePremiumOutlined />, perm: 'subscriptions.manage', group: 'المالية' },
  { to: '/admin/commissions', label: 'العمولات والمستحقات', icon: <PercentOutlined />, perm: 'finance.read', group: 'المالية' },
  { to: '/admin/coupons', label: 'أكواد الخصم', icon: <LocalOfferOutlined />, perm: 'coupons.manage', group: 'المالية' },
  { to: '/admin/users', label: 'المستخدمون', icon: <ManageAccountsOutlined />, perm: 'users.read', group: 'النظام' },
  { to: '/admin/analytics', label: 'التحليلات', icon: <QueryStatsOutlined />, perm: 'analytics.read', group: 'التحليلات والأمان' },
  { to: '/admin/security', label: 'مركز الأمان', icon: <ShieldOutlined />, perm: 'security.read', group: 'التحليلات والأمان' },
  { to: '/admin/audit-logs', label: 'سجل المراجعة', icon: <HistoryOutlined />, perm: 'audit.read', group: 'التحليلات والأمان' },
  { to: '/admin/system-health', label: 'صحة النظام', icon: <MonitorHeartOutlinedIcon />, perm: 'system.health', group: 'التحليلات والأمان' },
  { to: '/admin/system', label: 'إعدادات النظام', icon: <TuneOutlined />, perm: 'settings.manage', group: 'النظام' },
  { to: '/admin/notifications', label: 'الإشعارات', icon: <NotificationsOutlined />, group: 'النظام' },
];

const Loader = (
  <Box sx={{ minHeight: '50vh', display: 'grid', placeItems: 'center' }}>
    <CircularProgress />
  </Box>
);

/** While the subscription is expired only these pages stay open (renew, notices, account). */
const UNSUBSCRIBED_OK = ['subscription', 'notifications', 'settings'];

function ProviderShell({ nav, base }) {
  const { data } = useMyProvider();
  const { hasRole, user } = useAuth();
  const loc = useLocation();
  const items = base !== '/provider' ? nav : hasRole('LAB_ADMIN', 'LAB_STAFF') ? LAB_NAV : hasRole('RADIOLOGY_ADMIN', 'RADIOLOGY_STAFF') ? RAD_NAV : hasRole('PHARMACY_ADMIN', 'PHARMACY_STAFF') ? PH_NAV : nav;
  if (user?.subscription?.blocked) {
    const page = loc.pathname.slice(base.length + 1).split('/')[0];
    if (!UNSUBSCRIBED_OK.includes(page)) return <Navigate to={`${base}/subscription`} replace />;
    const locked = items.filter((i) => UNSUBSCRIBED_OK.some((k) => i.to === `${base}/${k}`)).map((i) => ({ ...i, group: undefined }));
    return <DashboardLayout nav={locked} base={base} />;
  }
  return (
    <DashboardLayout
      nav={items}
      base={base}
      banner={
        <>
          <VerificationBanner provider={data} />
          <SubscriptionBanner />
        </>
      }
    />
  );
}

/** Platform staff may be required to turn on two-step verification before anything else. */
function AdminShell() {
  const { user } = useAuth();
  const loc = useLocation();
  if (user?.twoFactorSetupRequired) {
    const page = loc.pathname.slice('/admin/'.length).split('/')[0];
    if (!['settings', 'notifications'].includes(page)) return <Navigate to="/admin/settings" replace />;
    return (
      <DashboardLayout
        nav={ADMIN_NAV.filter((i) => ['/admin/settings', '/admin/notifications'].includes(i.to)).concat([{ to: '/admin/settings', label: 'الإعدادات والأمان', icon: <SettingsOutlined /> }]).filter((v, i, a) => a.findIndex((x) => x.to === v.to) === i)}
        base="/admin"
        banner={<Alert severity="error" sx={{ borderRadius: 0 }}>فعّل التحقق بخطوتين من الإعدادات للمتابعة — مطلوب لحسابات فريق المنصة.</Alert>}
      />
    );
  }
  return <DashboardLayout nav={ADMIN_NAV} base="/admin" />;
}

function DoctorAppointmentsPage() {
  return (
    <>
      <PageHeaderLazy title="المواعيد" subtitle="أكّد الحجوزات، سجّل الحضور، وأنهِ الكشف — يصل للمريض إشعار بكل تغيير." />
      <AppointmentsManager scope="provider" patientBase="/doctor/patients" />
    </>
  );
}

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'ACCOUNTANT'];
const PROVIDER_ROLES = ['LAB_ADMIN', 'LAB_STAFF', 'RADIOLOGY_ADMIN', 'RADIOLOGY_STAFF', 'PHARMACY_ADMIN', 'PHARMACY_STAFF'];
const PH_ROLES = ['PHARMACY_ADMIN', 'PHARMACY_STAFF'];

export default function App() {
  return (
    <ConfirmProvider>
      <CartProvider>
      <Suspense fallback={Loader}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<Home />} />
            <Route path="doctors" element={<Doctors />} />
            <Route path="doctors/:key" element={<DoctorProfile />} />
            <Route path="specialties" element={<Specialties />} />
            <Route path="labs" element={<Providers type="LABORATORY" />} />
            <Route path="radiology" element={<Providers type="RADIOLOGY" />} />
            <Route path="pharmacies" element={<Providers type="PHARMACY" />} />
            <Route path="providers/:key" element={<ProviderProfile />} />
            <Route path="lab-tests" element={<LabTests />} />
            <Route path="labs/:key/book" element={<LabBooking />} />
            <Route path="verify/:code" element={<Verify />} />
            <Route path="verify-document" element={<Verify />} />
            <Route path="register/provider" element={<RegisterProvider />} />
            <Route path="radiology-services" element={<RadiologyServicesSearch />} />
            <Route path="radiology/:key/book" element={<RadiologyBooking />} />
            <Route path="medicines" element={<MedicinesSearch />} />
            <Route path="medicines/:id" element={<MedicineDetail />} />
            <Route path="checkout" element={<Checkout />} />
            <Route path="emergency" element={<Emergency />} />
            <Route path="pay/sandbox/:id" element={<SandboxCheckout />} />
            <Route path="payment/result" element={<PaymentResult />} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="register/doctor" element={<RegisterDoctor />} />
            <Route path="forgot-password" element={<ForgotPassword />} />
            <Route path="reset-password" element={<ResetPassword />} />
            <Route path="verify" element={<VerifyEmail />} />
            <Route path="*" element={<NotFound />} />
          </Route>

          <Route path="/patient" element={<RequireAuth roles={['PATIENT']}><DashboardLayout nav={PATIENT_NAV} base="/patient" banner={<CompleteNameDialog />} /></RequireAuth>}>
            <Route index element={<PatientDashboard />} />
            <Route path="appointments" element={<PatientAppointments />} />
            <Route path="medical-record" element={<MedicalRecord />} />
            <Route path="lab-orders" element={<PatientLabOrders />} />
            <Route path="lab-orders/:id" element={<PatientLabOrderDetail />} />
            <Route path="radiology" element={<PatientRadiology />} />
            <Route path="radiology/:id" element={<PatientRadiologyDetail />} />
            <Route path="prescriptions" element={<PatientPrescriptions />} />
            <Route path="prescriptions/:id" element={<PatientPrescriptionDetail />} />
            <Route path="pharmacy-orders" element={<PatientPharmacyOrders />} />
            <Route path="pharmacy-orders/:id" element={<PatientPharmacyOrderDetail />} />
            <Route path="payments" element={<PatientPayments />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="favorites" element={<PatientFavorites />} />
            <Route path="profile" element={<PatientProfile />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="/doctor" element={<RequireAuth roles={['DOCTOR']}><ProviderShell nav={DOCTOR_NAV} base="/doctor" /></RequireAuth>}>
            <Route index element={<DoctorDashboard />} />
            <Route path="appointments" element={<DoctorAppointmentsPage />} />
            <Route path="patients" element={<PatientsList base="/doctor/patients" />} />
            <Route path="patients/:id" element={<PatientDetail base="/doctor/patients" />} />
            <Route path="prescriptions" element={<DoctorPrescriptions />} />
            <Route path="prescriptions/:id" element={<DoctorPrescriptionDetail />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="reports" element={<DoctorReports />} />
            <Route path="reviews" element={<ReviewsPage />} />
            <Route path="profile" element={<DoctorProfileEdit />} />
            <Route path="subscription" element={<SubscriptionPage />} />
            <Route path="earnings" element={<RequireAuth perm="payments.read.provider"><EarningsPage /></RequireAuth>} />
            <Route path="analytics" element={<RequireAuth perm="dashboard.provider"><AnalyticsPage scope="provider" /></RequireAuth>} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="/provider" element={<RequireAuth roles={PROVIDER_ROLES}><ProviderShell nav={PROVIDER_NAV} base="/provider" /></RequireAuth>}>
            <Route index element={<ProviderHome />} />
            <Route path="lab" element={<RequireAuth roles={['LAB_ADMIN', 'LAB_STAFF']}><LabDashboard /></RequireAuth>} />
            <Route path="orders" element={<RequireAuth roles={['LAB_ADMIN', 'LAB_STAFF']}><LabOrdersBoard /></RequireAuth>} />
            <Route path="orders/:id" element={<RequireAuth roles={['LAB_ADMIN', 'LAB_STAFF']}><LabOrderWork /></RequireAuth>} />
            <Route path="catalog" element={<RequireAuth roles={['LAB_ADMIN', 'LAB_STAFF']}><LabCatalog /></RequireAuth>} />
            <Route path="lab-settings" element={<RequireAuth roles={['LAB_ADMIN', 'LAB_STAFF']}><LabSettings /></RequireAuth>} />
            <Route path="team" element={<RequireAuth perm="provider.manage.own"><LabTeam /></RequireAuth>} />
            <Route path="radiology" element={<RequireAuth roles={['RADIOLOGY_ADMIN', 'RADIOLOGY_STAFF']}><RadDashboard /></RequireAuth>} />
            <Route path="bookings" element={<RequireAuth roles={['RADIOLOGY_ADMIN', 'RADIOLOGY_STAFF']}><RadOrdersBoard /></RequireAuth>} />
            <Route path="bookings/:id" element={<RequireAuth roles={['RADIOLOGY_ADMIN', 'RADIOLOGY_STAFF']}><RadOrderWork /></RequireAuth>} />
            <Route path="services" element={<RequireAuth roles={['RADIOLOGY_ADMIN', 'RADIOLOGY_STAFF']}><RadServices /></RequireAuth>} />
            <Route path="radiology-settings" element={<RequireAuth roles={['RADIOLOGY_ADMIN', 'RADIOLOGY_STAFF']}><RadSettings /></RequireAuth>} />
            <Route path="pharmacy" element={<RequireAuth roles={PH_ROLES}><PhDashboard /></RequireAuth>} />
            <Route path="pharmacy-orders" element={<RequireAuth roles={PH_ROLES}><PhOrdersBoard /></RequireAuth>} />
            <Route path="pharmacy-orders/:id" element={<RequireAuth roles={PH_ROLES}><PhOrderWork /></RequireAuth>} />
            <Route path="inventory" element={<RequireAuth roles={PH_ROLES}><PhInventory /></RequireAuth>} />
            <Route path="rx-verify" element={<RequireAuth perm="prescriptions.verify"><PhVerify /></RequireAuth>} />
            <Route path="pharmacy-settings" element={<RequireAuth roles={PH_ROLES}><PhSettings /></RequireAuth>} />
            <Route path="subscription" element={<SubscriptionPage />} />
            <Route path="earnings" element={<RequireAuth perm="payments.read.provider"><EarningsPage /></RequireAuth>} />
            <Route path="analytics" element={<RequireAuth perm="dashboard.provider"><AnalyticsPage scope="provider" /></RequireAuth>} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="/admin" element={<RequireAuth roles={ADMIN_ROLES}><AdminShell /></RequireAuth>}>
            <Route index element={<AdminDashboard />} />
            <Route path="providers" element={<AdminProviders />} />
            <Route path="providers/:id" element={<AdminProviderDetail />} />
            <Route path="doctors" element={<AdminProviders fixedType="DOCTOR" title="الأطباء" />} />
            <Route path="specialties" element={<AdminSpecialties />} />
            <Route path="appointments" element={<AdminAppointments />} />
            <Route path="lab-orders" element={<RequireAuth perm="lab.orders.read.any"><AdminLabOrders /></RequireAuth>} />
            <Route path="radiology-orders" element={<RequireAuth perm="radiology.orders.read.any"><AdminRadiologyOrders /></RequireAuth>} />
            <Route path="pharmacy-orders" element={<RequireAuth perm="pharmacy.orders.read.any"><AdminPharmacyOrders /></RequireAuth>} />
            <Route path="medicines" element={<RequireAuth perm="medicines.manage"><AdminMedicines /></RequireAuth>} />
            <Route path="patients" element={<AdminUsers fixedRole="PATIENT" title="المرضى" />} />
            <Route path="reviews" element={<AdminReviews />} />
            <Route path="chat" element={<RequireAuth perm="chat.support"><ChatPage /></RequireAuth>} />
            <Route path="reports" element={<AdminReports />} />
            <Route path="finance" element={<RequireAuth perm="finance.read"><AdminFinanceDashboard /></RequireAuth>} />
            <Route path="payments" element={<RequireAuth perm="finance.read"><AdminPayments /></RequireAuth>} />
            <Route path="subscriptions" element={<RequireAuth perm="subscriptions.manage"><AdminSubscriptions /></RequireAuth>} />
            <Route path="commissions" element={<RequireAuth perm="finance.read"><AdminCommissions /></RequireAuth>} />
            <Route path="coupons" element={<RequireAuth perm="coupons.manage"><AdminCoupons /></RequireAuth>} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="audit-logs" element={<RequireAuth perm="audit.read"><AdminAudit /></RequireAuth>} />
            <Route path="analytics" element={<RequireAuth perm="analytics.read"><AnalyticsPage scope="admin" /></RequireAuth>} />
            <Route path="security" element={<RequireAuth perm="security.read"><AdminSecurity /></RequireAuth>} />
            <Route path="system-health" element={<RequireAuth perm="system.health"><AdminSystemHealth /></RequireAuth>} />
            <Route path="system" element={<AdminSettings />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="/home" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </CartProvider>
    </ConfirmProvider>
  );
}
