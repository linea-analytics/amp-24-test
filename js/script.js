(() => {
    const tabButtons = Array.from(document.querySelectorAll('#ampNav [data-bs-toggle="pill"]'));
    const btnNext = document.getElementById('btnNext');
    const btnPrev = document.getElementById('btnPrev');

    function activeIndex() {
        return tabButtons.findIndex(b => b.classList.contains('active'));
    }

    function showTab(index) {
        const i = Math.max(0, Math.min(index, tabButtons.length - 1));
        new bootstrap.Tab(tabButtons[i]).show();
    }

    function syncButtons() {
        const i = activeIndex();
        const isFirst = i <= 0;
        const isLast = i === tabButtons.length - 1;

        btnPrev.disabled = isFirst;
        btnNext.textContent = isLast ? 'Back to Start' : 'Next Section';
    }

    btnNext?.addEventListener('click', () => {
        const i = activeIndex();
        if (i === tabButtons.length - 1) return showTab(0);
        showTab(i + 1);
    });

    btnPrev?.addEventListener('click', () => {
        const i = activeIndex();
        showTab(i - 1);
    });

    tabButtons.forEach(btn => btn.addEventListener('shown.bs.tab', syncButtons));

    syncButtons();
})();


// CHART

// - HELPERS
function parseBinCentres(binLabels) {
    // "0–10" -> 5
    return binLabels.map(l => {
        const parts = String(l).split('–').map(s => Number(s.trim()));
        if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
        return (parts[0] + parts[1]) / 2;
    });
}

function meanFromBinnedPercent(centres, pct) {
    // centres: [5, 15, 25...], pct sums to 100
    let num = 0;
    let den = 0;
    for (let i = 0; i < centres.length; i++) {
        const c = centres[i];
        const p = Number(pct[i] ?? 0);
        if (c == null || Number.isNaN(c) || Number.isNaN(p)) continue;
        num += c * p;
        den += p;
    }
    return den > 0 ? (num / den) : null;
}

function nearestIndex(centres, value) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < centres.length; i++) {
        const c = centres[i];
        if (c == null) continue;
        const d = Math.abs(c - value);
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }
    return bestIdx;
}

const meanLinesPlugin = {
    id: 'meanLines',
    afterDatasetsDraw(chart) {
        const means = chart.$means;
        const centres = chart.$centres;
        if (!means || !centres) return;

        const { ctx, chartArea, scales } = chart;
        const x = scales.x;
        if (!x) return;

        ctx.save();

        const lineStyle = (label) => {
            // Slightly different styles, but keep it subtle
            if (label.toLowerCase().includes('treatment')) {
                ctx.setLineDash([]); // solid
                ctx.globalAlpha = 0.9;
            } else {
                ctx.setLineDash([6, 6]); // dashed
                ctx.globalAlpha = 0.9;
            }
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
            ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
            ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        };

        means.forEach(m => {
            if (!m || m.value == null) return;

            const idx = nearestIndex(centres, m.value);
            const xp = x.getPixelForValue(idx);

            // line
            lineStyle(m.label);
            ctx.beginPath();
            ctx.moveTo(xp, chartArea.top);
            ctx.lineTo(xp, chartArea.bottom);
            ctx.stroke();

            // label bubble-ish (simple)
            const text = `${m.label} mean: ${m.value.toFixed(1)}`;
            const padX = 8, padY = 5;
            const textW = ctx.measureText(text).width;
            const boxW = textW + padX * 2;
            const boxH = 22;
            const boxX = Math.min(Math.max(xp + 8, chartArea.left + 6), chartArea.right - boxW - 6);
            const boxY = chartArea.top + 8;

            ctx.globalAlpha = 0.85;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
            ctx.strokeStyle = 'rgba(15, 23, 42, 0.18)';
            ctx.setLineDash([]);
            ctx.lineWidth = 1;

            ctx.beginPath();
            const r = 10;
            ctx.roundRect(boxX, boxY, boxW, boxH, r);
            ctx.fill();
            ctx.stroke();

            ctx.globalAlpha = 0.9;
            ctx.fillStyle = 'rgba(15, 23, 42, 0.80)';
            ctx.fillText(text, boxX + padX, boxY + 15);
        });

        ctx.restore();
    }
};


// - CHART
(() => {
    const elGender = document.getElementById('ppGender');
    const elAge = document.getElementById('ppAge');

    const countsCanvas = document.getElementById('ppCountsChart');
    const distCanvas = document.getElementById('ppDistChart');

    // If we are not on the Patient Population tab (or canvases not present), do nothing
    if (!countsCanvas || !distCanvas || !window.Chart) return;

    let PP_DATA = null;
    let countsChart = null;
    let distChart = null;

    function getSegmentKey() {
        const g = elGender?.value || 'total';
        const a = elAge?.value || 'all';
        return `${g}|${a}`;
    }

    function getSegment() {
        if (!PP_DATA) return null;
        const key = getSegmentKey();
        return PP_DATA.segments[key] || PP_DATA.segments['total|all'];
    }

    function buildChartsFromSegment(seg) {
        // Counts chart
        countsChart = new Chart(countsCanvas, {
            type: 'bar',
            data: {
                labels: ['Sample size', 'Control group'],
                datasets: [{
                    label: 'Participants',
                    data: [seg.counts.sample, seg.counts.control],
                    borderWidth: 1,
                    borderRadius: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: { label: (ctx) => ` ${Number(ctx.raw).toLocaleString('en-GB')}` }
                    }
                },
                scales: {
                    x: { grid: { display: false } },
                    y: {
                        beginAtZero: true,
                        ticks: { callback: (v) => Number(v).toLocaleString('en-GB') }
                    }
                }
            }
        });

        const centres = parseBinCentres(seg.distribution.bin_labels);

        distChart = new Chart(distCanvas, {
            type: 'line',
            data: {
                labels: seg.distribution.bin_labels,
                datasets: [
                    {
                        label: 'Control (%)',
                        data: seg.distribution.control_pct,
                        tension: 0.35,
                        fill: true,
                        pointRadius: 0,
                        borderWidth: 2,
                        backgroundColor: 'rgba(15, 23, 42, 0.10)'
                    },
                    {
                        label: 'Treatment (%)',
                        data: seg.distribution.treatment_pct,
                        tension: 0.35,
                        fill: true,
                        pointRadius: 0,
                        borderWidth: 2,
                        backgroundColor: 'rgba(79, 70, 229, 0.12)'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', align: 'end' },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.raw).toFixed(1)}%`
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Percentage (%)' },
                        ticks: { callback: (v) => `${v}%` }
                    }
                }
            },
            plugins: [meanLinesPlugin]
        });

        // Store centres + means on the chart instance for the plugin to use
        distChart.$centres = centres;
        distChart.$means = [
            { label: 'Control', value: meanFromBinnedPercent(centres, seg.distribution.control_pct) },
            { label: 'Treatment', value: meanFromBinnedPercent(centres, seg.distribution.treatment_pct) }
        ];

    }

    function updateCharts(seg) {
        if (!countsChart || !distChart) return;

        countsChart.data.datasets[0].data = [seg.counts.sample, seg.counts.control];
        countsChart.update();

        distChart.data.labels = seg.distribution.bin_labels;
        distChart.data.datasets[0].data = seg.distribution.control_pct;
        distChart.data.datasets[1].data = seg.distribution.treatment_pct;

        const centres = parseBinCentres(seg.distribution.bin_labels);
        distChart.$centres = centres;
        distChart.$means = [
            { label: 'Control', value: meanFromBinnedPercent(centres, seg.distribution.control_pct) },
            { label: 'Treatment', value: meanFromBinnedPercent(centres, seg.distribution.treatment_pct) }
        ];

        distChart.update();

    }

    function hookDrilldowns() {
        const onChange = () => {
            const seg = getSegment();
            if (seg) updateCharts(seg);
        };
        elGender?.addEventListener('change', onChange);
        elAge?.addEventListener('change', onChange);
    }

    async function init() {
        // Put the downloaded file here in your project:
        // public/data/patient_population.json
        const res = await fetch('data/patient_population.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to load patient_population.json (${res.status})`);

        PP_DATA = await res.json();

        const seg = getSegment();
        if (!seg) return;

        buildChartsFromSegment(seg);
        hookDrilldowns();
    }

    init().catch((err) => {
        console.error(err);
    });
})();
