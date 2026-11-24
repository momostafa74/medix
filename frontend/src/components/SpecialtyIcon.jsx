import Stethoscope from '@mui/icons-material/MedicalServicesOutlined';
import Favorite from '@mui/icons-material/FavoriteBorder';
import Mood from '@mui/icons-material/SentimentSatisfiedAltOutlined';
import Face from '@mui/icons-material/FaceOutlined';
import ChildCare from '@mui/icons-material/ChildCareOutlined';
import Accessibility from '@mui/icons-material/AccessibilityNewOutlined';
import Psychology from '@mui/icons-material/PsychologyOutlined';
import Visibility from '@mui/icons-material/VisibilityOutlined';
import Pregnant from '@mui/icons-material/PregnantWomanOutlined';
import Hearing from '@mui/icons-material/HearingOutlined';
import WaterDrop from '@mui/icons-material/WaterDropOutlined';
import SelfImprovement from '@mui/icons-material/SelfImprovementOutlined';
import Restaurant from '@mui/icons-material/RestaurantOutlined';
import Health from '@mui/icons-material/HealthAndSafetyOutlined';

const MAP = {
  stethoscope: Stethoscope,
  favorite: Favorite,
  mood: Mood,
  face: Face,
  child_care: ChildCare,
  accessibility: Accessibility,
  psychology: Psychology,
  visibility: Visibility,
  pregnant_woman: Pregnant,
  hearing: Hearing,
  water_drop: WaterDrop,
  self_improvement: SelfImprovement,
  restaurant: Restaurant,
  health_and_safety: Health,
};

export const SPECIALTY_ICONS = Object.keys(MAP);

export default function SpecialtyIcon({ name, ...props }) {
  const C = MAP[name] || Stethoscope;
  return <C {...props} />;
}
