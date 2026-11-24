import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Box, Typography } from '@mui/material';
import { tokens } from '../theme';

// Validated categorical order: petrol, saffron, sage, slate, signal
export const SERIES = [tokens.petrol, tokens.saffron, '#6BA292', '#7C8B96', tokens.signal];
const axis = { tick: { fontSize: 12, fill: tokens.inkSoft }, stroke: tokens.line };
const tip = { contentStyle: { borderRadius: 8, borderColor: tokens.line, fontFamily: 'inherit', direction: 'rtl' } };
const legendText = (v) => <span style={{ marginInlineStart: 6, marginInlineEnd: 10, color: tokens.ink }}>{v}</span>;
const shortDate = (d) => (d?.length === 10 ? d.slice(5).replace('-', '/') : d);

function Empty({ height }) {
  return (
    <Box sx={{ height, display: 'grid', placeItems: 'center' }}>
      <Typography color="text.secondary">لا توجد بيانات في هذه الفترة</Typography>
    </Box>
  );
}

export function StackedBars({ data, keys, height = 260, xKey = 'date', money }) {
  if (!data?.length) return <Empty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={tokens.line} />
        <XAxis dataKey={xKey} tickFormatter={shortDate} reversed {...axis} />
        <YAxis allowDecimals={false} orientation="right" width={money ? 64 : 36} tickFormatter={(v) => (money ? v.toLocaleString('en-US') : v)} {...axis} />
        <Tooltip {...tip} labelFormatter={shortDate} formatter={(v) => (money ? `${Number(v).toLocaleString('en-US')} ج.م` : v)} />
        <Legend wrapperStyle={{ fontSize: 13 }} formatter={legendText} />
        {keys.map((k, i) => (
          <Bar key={k.key} dataKey={k.key} name={k.label} stackId="s" fill={k.color || SERIES[i]} radius={i === keys.length - 1 ? [3, 3, 0, 0] : 0} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendLine({ data, dataKey, name, height = 240, xKey = 'date', money }) {
  if (!data?.length) return <Empty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={tokens.line} />
        <XAxis dataKey={xKey} tickFormatter={shortDate} reversed {...axis} />
        <YAxis orientation="right" width={money ? 64 : 36} tickFormatter={(v) => (money ? v.toLocaleString('en-US') : v)} {...axis} />
        <Tooltip {...tip} labelFormatter={shortDate} formatter={(v) => (money ? `${Number(v).toLocaleString('en-US')} ج.م` : v)} />
        <Line type="linear" dataKey={dataKey} name={name} stroke={tokens.petrol} strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SimpleBars({ data, xKey, yKey, name, height = 240, color = tokens.petrol, horizontal }) {
  if (!data?.length) return <Empty height={height} />;
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={Math.max(height, data.length * 34)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <XAxis type="number" allowDecimals={false} reversed {...axis} />
          <YAxis type="category" dataKey={xKey} orientation="right" width={140} {...axis} />
          <Tooltip {...tip} />
          <Bar dataKey={yKey} name={name} fill={color} radius={[3, 0, 0, 3]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={tokens.line} />
        <XAxis dataKey={xKey} tickFormatter={shortDate} reversed {...axis} />
        <YAxis allowDecimals={false} orientation="right" width={64} tickFormatter={(v) => v.toLocaleString("en-US")} {...axis} />
        <Tooltip {...tip} labelFormatter={shortDate} />
        <Bar dataKey={yKey} name={name} fill={color} radius={[3, 3, 0, 0]} maxBarSize={30} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, nameKey, valueKey, height = 240, labels = {} }) {
  if (!data?.length) return <Empty height={height} />;
  const rows = data.map((d) => ({ ...d, _name: labels[d[nameKey]] || d[nameKey] }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={rows} dataKey={valueKey} nameKey="_name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="#fff">
          {rows.map((_, i) => (
            <Cell key={i} fill={SERIES[i % SERIES.length]} />
          ))}
        </Pie>
        <Tooltip {...tip} />
        <Legend wrapperStyle={{ fontSize: 13 }} formatter={legendText} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Ranked list with inline bars — reads naturally in RTL and keeps long Arabic labels intact. */
export function RankBars({ data, labelKey, valueKey, unit = '' }) {
  if (!data?.length) return <Empty height={160} />;
  const max = Math.max(...data.map((d) => d[valueKey]), 1);
  return (
    <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {data.map((d) => (
        <Box component="li" key={d[labelKey]} sx={{ py: 0.75 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{d[labelKey]}</Typography>
            <Typography variant="body2" color="text.secondary">{d[valueKey]}{unit}</Typography>
          </Box>
          <Box sx={{ height: 8, borderRadius: 4, bgcolor: tokens.paper }}>
            <Box sx={{ height: 8, borderRadius: 4, bgcolor: tokens.petrol, width: `${(d[valueKey] / max) * 100}%` }} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** Current period vs the comparison period (dashed), aligned bucket by bucket. */
export function CompareLine({ data, dataKey, previousKey, name, previousName = 'الفترة السابقة', height = 260, xKey = 'bucket', money }) {
  if (!data?.length) return <Empty height={height} />;
  const fmt = (v) => (money ? `${Number(v).toLocaleString('en-US')} ج.م` : v);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={tokens.line} />
        <XAxis dataKey={xKey} tickFormatter={shortDate} reversed {...axis} />
        <YAxis orientation="right" width={money ? 64 : 40} tickFormatter={(v) => (money ? v.toLocaleString('en-US') : v)} allowDecimals={false} {...axis} />
        <Tooltip {...tip} labelFormatter={shortDate} formatter={fmt} />
        <Legend wrapperStyle={{ fontSize: 13 }} formatter={legendText} />
        <Line type="linear" dataKey={dataKey} name={name} stroke={tokens.petrol} strokeWidth={2.5} dot={false} />
        {previousKey && <Line type="linear" dataKey={previousKey} name={previousName} stroke={SERIES[3]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />}
      </LineChart>
    </ResponsiveContainer>
  );
}
