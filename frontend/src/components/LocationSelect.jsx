import { MenuItem, Stack, TextField } from '@mui/material';
import { useLocationsTree } from '../api/queries';

/** Cascading governorate → city → area select. value: { governorateId, cityId, areaId } */
export default function LocationSelect({ value = {}, onChange, withGovernorate = true, size = 'small', direction = { xs: 'column', sm: 'row' } }) {
  const { data: tree = [] } = useLocationsTree();
  const gov = tree.find((g) => g.id === value.governorateId) || (value.cityId ? tree.find((g) => g.cities.some((c) => c.id === value.cityId)) : null);
  const cities = gov ? gov.cities : tree.flatMap((g) => g.cities);
  const city = cities.find((c) => c.id === value.cityId);
  const areas = city ? city.areas : [];
  return (
    <Stack direction={direction} spacing={1.5} sx={{ width: '100%' }}>
      {withGovernorate && (
        <TextField select size={size} label="المحافظة" value={gov?.id || ''} onChange={(e) => onChange({ governorateId: e.target.value || undefined, cityId: undefined, areaId: undefined })}>
          <MenuItem value="">كل المحافظات</MenuItem>
          {tree.map((g) => (
            <MenuItem key={g.id} value={g.id}>
              {g.nameAr}
            </MenuItem>
          ))}
        </TextField>
      )}
      <TextField select size={size} label="المدينة" value={value.cityId || ''} onChange={(e) => onChange({ governorateId: gov?.id, cityId: e.target.value || undefined, areaId: undefined })}>
        <MenuItem value="">{withGovernorate ? 'كل المدن' : '—'}</MenuItem>
        {cities.map((c) => (
          <MenuItem key={c.id} value={c.id}>
            {c.nameAr}
          </MenuItem>
        ))}
      </TextField>
      <TextField select size={size} label="المنطقة" value={value.areaId || ''} disabled={!city} onChange={(e) => onChange({ governorateId: gov?.id, cityId: value.cityId, areaId: e.target.value || undefined })}>
        <MenuItem value="">{withGovernorate ? 'كل المناطق' : '—'}</MenuItem>
        {areas.map((a) => (
          <MenuItem key={a.id} value={a.id}>
            {a.nameAr}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}
