
const socket = new WebSocket('ws://localhost:8081');

const serverSelect =
    document.getElementById('serverSelect');

const cpuCtx =
    document.getElementById('cpuChart')
        .getContext('2d');

const ramCtx =
    document.getElementById('ramChart')
        .getContext('2d');

const serverMetrics = {};

const colors = [
    '#4caf50',
    '#2196f3',
    '#ff9800',
    '#e91e63'
];

const maxVisiblePoints = 20;
const metricsStorageKey = 'server-monitoring-metrics-v1';
const selectedServerStorageKey = 'server-monitoring-selected-v1';

function saveSelectedServer() {
    if (!window.localStorage) return;
    try {
        window.localStorage.setItem(selectedServerStorageKey, serverSelect.value);
    } catch {}
}

function restoreSelectedServer() {
    if (!window.localStorage) return;
    try {
        const saved = window.localStorage.getItem(selectedServerStorageKey);
        const exists = saved &&
            [...serverSelect.options].some(o => o.value === saved);
        if (exists) serverSelect.value = saved;
    } catch {}
}

function serverKey(hostname) {

    return String(hostname || '')
        .trim()
        .toLowerCase();
}

class LineChart {
    constructor(ctx, label, color) {
        this.ctx = ctx;
        this.label = label;
        this.color = color;
        this.labels = [];
        this.values = [];
        this.points = [];
        this.hoverPoint = null;
        this.pendingFrame = false;
        this.size = {
            width: 0,
            height: 0
        };

        window.addEventListener('resize', () => {
            this.scheduleDraw();
        });

        this.ctx.canvas.addEventListener('mousemove', (event) => {
            this.handleMouseMove(event);
        });

        this.ctx.canvas.addEventListener('mouseleave', () => {
            this.hoverPoint = null;
            this.scheduleDraw();
        });
    }

    setData(labels, values) {
        this.labels = labels;
        this.values = values;
        this.scheduleDraw();
    }

    scheduleDraw() {
        if (this.pendingFrame) return;

        this.pendingFrame = true;

        window.requestAnimationFrame(() => {
            this.pendingFrame = false;
            this.draw();
        });
    }

    handleMouseMove(event) {
        const rect = this.ctx.canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const hitRadius = 14;

        const nearestPoint = this.points.find(point => {
            const distance =
                Math.hypot(point.x - mouseX, point.y - mouseY);

            return distance <= hitRadius;
        });

        if (nearestPoint !== this.hoverPoint) {
            this.hoverPoint = nearestPoint || null;
            this.scheduleDraw();
        }
    }

    draw() {
        const canvas = this.ctx.canvas;
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(rect.width * dpr));
        const height = Math.max(1, Math.round(rect.height * dpr));

        if (
            this.size.width !== width ||
            this.size.height !== height
        ) {
            canvas.width = width;
            canvas.height = height;
            this.size.width = width;
            this.size.height = height;
        }

        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.ctx.clearRect(0, 0, rect.width, rect.height);

        const padding = {
            top: 38,
            right: 18,
            bottom: 38,
            left: 48
        };
        const chartWidth = rect.width - padding.left - padding.right;
        const chartHeight = rect.height - padding.top - padding.bottom;

        this.drawFrame(rect, padding, chartWidth, chartHeight);

        if (!this.values.length) {
            this.drawEmptyState(rect);
            return;
        }

        const visibleSlots =
            maxVisiblePoints - 1;

        const slotOffset =
            Math.max(0, maxVisiblePoints - this.values.length);

        const dataPoints = this.values.map((value, index) => {
            const slotIndex =
                this.values.length === 1
                    ? visibleSlots
                    : slotOffset + index;

            const x =
                padding.left +
                (slotIndex / visibleSlots) * chartWidth;

            const y =
                padding.top +
                chartHeight -
                (Math.min(100, Math.max(0, value)) / 100) * chartHeight;

            return {
                x,
                y,
                label: this.labels[index],
                value
            };
        });

        this.points = dataPoints;

        if (dataPoints.length > 1) {
            this.drawArea(dataPoints, padding.top + chartHeight);

            this.ctx.strokeStyle = this.color;
            this.ctx.lineWidth = 4;
            this.ctx.lineJoin = 'round';
            this.ctx.lineCap = 'round';
            this.ctx.beginPath();

            dataPoints.forEach((point, index) => {
                if (index === 0) {
                    this.ctx.moveTo(point.x, point.y);
                } else if (index < dataPoints.length - 1) {
                    const nextPoint = dataPoints[index + 1];
                    const controlX = (point.x + nextPoint.x) / 2;
                    const controlY = (point.y + nextPoint.y) / 2;

                    this.ctx.quadraticCurveTo(
                        point.x,
                        point.y,
                        controlX,
                        controlY
                    );
                } else {
                    this.ctx.lineTo(point.x, point.y);
                }
            });

            this.ctx.stroke();
        }

        this.ctx.fillStyle = this.color;
        dataPoints.forEach(point => {
            this.ctx.beginPath();
            this.ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
            this.ctx.fill();
        });

        const lastValue = this.values[this.values.length - 1];
        this.ctx.fillStyle = '#172033';
        this.ctx.font = 'bold 16px sans-serif';
        this.ctx.fillText(
            `${this.label}: ${lastValue.toFixed(1)}%`,
            padding.left,
            24
        );

        this.drawTimeLabels(rect, padding, chartWidth);
        this.drawTooltip(rect);
    }

    drawArea(points, baselineY) {
        if (points.length < 2) return;

        const gradient =
            this.ctx.createLinearGradient(0, 0, 0, baselineY);

        gradient.addColorStop(0, `${this.color}44`);
        gradient.addColorStop(1, `${this.color}00`);

        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.moveTo(points[0].x, baselineY);
        points.forEach(point => {
            this.ctx.lineTo(point.x, point.y);
        });
        this.ctx.lineTo(points[points.length - 1].x, baselineY);
        this.ctx.closePath();
        this.ctx.fill();
    }

    drawFrame(rect, padding, chartWidth, chartHeight) {
        this.ctx.strokeStyle = '#d8dee9';
        this.ctx.lineWidth = 1;
        this.ctx.fillStyle = '#64748b';
        this.ctx.font = '12px sans-serif';

        [0, 25, 50, 75, 100].forEach(value => {
            const y =
                padding.top +
                chartHeight -
                (value / 100) * chartHeight;

            this.ctx.beginPath();
            this.ctx.moveTo(padding.left, y);
            this.ctx.lineTo(rect.width - padding.right, y);
            this.ctx.stroke();
            this.ctx.fillText(`${value}%`, 8, y + 4);
        });

        this.ctx.strokeStyle = '#94a3b8';
        this.ctx.beginPath();
        this.ctx.moveTo(padding.left, padding.top);
        this.ctx.lineTo(padding.left, padding.top + chartHeight);
        this.ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        this.ctx.stroke();
    }

    drawTimeLabels(rect, padding, chartWidth) {
        if (!this.labels.length) return;

        const firstLabel = this.labels[0];
        const lastLabel = this.labels[this.labels.length - 1];
        const y = rect.height - 10;

        this.ctx.fillStyle = '#64748b';
        this.ctx.font = '12px sans-serif';

        if (this.labels.length === 1) {
            const labelWidth = this.ctx.measureText(firstLabel).width;
            this.ctx.fillText(
                firstLabel,
                padding.left + chartWidth - labelWidth,
                y
            );
            return;
        }

        this.ctx.fillText(firstLabel, padding.left, y);

        const lastLabelWidth = this.ctx.measureText(lastLabel).width;
        this.ctx.fillText(
            lastLabel,
            padding.left + chartWidth - lastLabelWidth,
            y
        );
    }

    drawTooltip(rect) {
        if (!this.hoverPoint) return;

        const valueText =
            `${this.label}: ${this.hoverPoint.value.toFixed(1)}%`;
        const timeText =
            `Date and Time: ${this.hoverPoint.label}`;
        const tooltipWidth =
            Math.max(
                this.ctx.measureText(valueText).width,
                this.ctx.measureText(timeText).width
            ) + 24;
        const tooltipHeight = 58;
        const margin = 12;
        let x = this.hoverPoint.x + 14;
        let y = this.hoverPoint.y - tooltipHeight - 12;

        if (x + tooltipWidth > rect.width - margin) {
            x = this.hoverPoint.x - tooltipWidth - 14;
        }

        if (y < margin) {
            y = this.hoverPoint.y + 14;
        }

        this.ctx.fillStyle = '#172033';
        this.roundRect(x, y, tooltipWidth, tooltipHeight, 8);
        this.ctx.fill();

        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 13px sans-serif';
        this.ctx.fillText(valueText, x + 12, y + 22);
        this.ctx.font = '12px sans-serif';
        this.ctx.fillText(timeText, x + 12, y + 42);

        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(
            this.hoverPoint.x,
            this.hoverPoint.y,
            6,
            0,
            Math.PI * 2
        );
        this.ctx.stroke();
    }

    roundRect(x, y, width, height, radius) {
        this.ctx.beginPath();
        this.ctx.moveTo(x + radius, y);
        this.ctx.lineTo(x + width - radius, y);
        this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        this.ctx.lineTo(x + width, y + height - radius);
        this.ctx.quadraticCurveTo(
            x + width,
            y + height,
            x + width - radius,
            y + height
        );
        this.ctx.lineTo(x + radius, y + height);
        this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        this.ctx.lineTo(x, y + radius);
        this.ctx.quadraticCurveTo(x, y, x + radius, y);
        this.ctx.closePath();
    }

    drawEmptyState(rect) {
        this.ctx.fillStyle = '#64748b';
        this.ctx.font = '14px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(
            `No ${this.label} data`,
            rect.width / 2,
            rect.height / 2
        );
        this.ctx.textAlign = 'start';
    }
}

const cpuChart = new LineChart(cpuCtx, 'CPU Usage', colors[0]);
const ramChart = new LineChart(ramCtx, 'RAM Usage', colors[1]);

function addServerOption(hostname) {

    const key =
        serverKey(hostname);

    const exists =
        [...serverSelect.options]
            .some(option =>
                option.value === key
            );

    if (exists) return;

    const option =
        document.createElement('option');

    option.value = key;
    option.textContent = hostname;

    serverSelect.appendChild(option);
}

function formatTime(timestamp, includeDate = false) {
    const date = new Date(timestamp);

    if (includeDate) {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `${day}.${month}.${year} ${time}`;
    }

    return date.toLocaleTimeString();
}

function calculateStatus(metric) {

    const cpuUsage = Number(metric.cpuUsage);
    const ramUsage = Number(metric.ramUsage);
    const diskUsage = Number(metric.diskUsage);

    if (
        cpuUsage >= 90 ||
        ramUsage >= 90 ||
        diskUsage >= 95
    ) {
        return 'CRITICAL';
    }

    if (
        cpuUsage >= 70 ||
        ramUsage >= 75 ||
        diskUsage >= 80
    ) {
        return 'WARNING';
    }

    return 'OK';
}

function normalizeMetric(metric) {

    return {
        ...metric,
        timestamp: metric.timestamp || new Date().toISOString(),
        status: metric.status || calculateStatus(metric)
    };
}

function metricKey(metric) {

    return [
        metric.timestamp,
        metric.cpuUsage,
        metric.ramUsage,
        metric.diskUsage
    ].join('|');
}

function addMetric(metric) {

    const key =
        serverKey(metric.hostname);

    if (!serverMetrics[key]) {
        serverMetrics[key] = [];
    }

    const metrics =
        serverMetrics[key];

    const existingIndex =
        metrics.findIndex(item =>
            metricKey(item) === metricKey(metric)
        );

    if (existingIndex >= 0) {
        metrics[existingIndex] = metric;
    } else {
        metrics.push(metric);
    }

    metrics.sort((first, second) =>
        new Date(first.timestamp) - new Date(second.timestamp)
    );

    if (metrics.length > maxVisiblePoints) {
        metrics.splice(0, metrics.length - maxVisiblePoints);
    }

    return metrics;
}

function saveMetrics() {

    if (!window.localStorage) return;

    try {
        window.localStorage.setItem(
            metricsStorageKey,
            JSON.stringify(serverMetrics)
        );
    } catch {
        // Storage is only a convenience cache; live data still works without it.
    }
}

function restoreMetrics() {

    if (!window.localStorage) return;

    let storedMetrics;

    try {
        storedMetrics =
            JSON.parse(
                window.localStorage.getItem(metricsStorageKey)
            );
    } catch {
        return;
    }

    if (!storedMetrics || typeof storedMetrics !== 'object') return;

    Object.keys(storedMetrics).forEach(hostname => {
        const metrics = storedMetrics[hostname];

        if (!Array.isArray(metrics)) return;

        metrics.forEach(rawMetric => {
            const metric =
                normalizeMetric(rawMetric);

            addServerOption(metric.hostname);
            addMetric(metric);
        });
    });

    const firstServer =
        Object.keys(serverMetrics)[0];

    restoreSelectedServer();

    if (!serverSelect.value && firstServer) {
        serverSelect.value = firstServer;
    }

    renderSelectedServer();
}

function renderSelectedServer() {

    const metrics =
        serverMetrics[serverSelect.value];

    if (!metrics || !metrics.length) return;

    updateCharts(metrics);
    updateInfo(metrics[metrics.length - 1]);
}

function updateCharts(metrics) {

    const recentMetrics =
        metrics.slice(-maxVisiblePoints);

    const labels = [];
    const cpuValues = [];
    const ramValues = [];

    const spansMultipleDays =
        recentMetrics.length > 1 &&
        new Date(recentMetrics[0].timestamp).toDateString() !==
        new Date(recentMetrics[recentMetrics.length - 1].timestamp).toDateString();

    recentMetrics.forEach(metric => {

        const time =
            formatTime(metric.timestamp, spansMultipleDays);

        labels.push(time);
        cpuValues.push(Number(metric.cpuUsage));
        ramValues.push(Number(metric.ramUsage));
    });

    cpuChart.setData(labels, cpuValues);
    ramChart.setData(labels, ramValues);
}

function updateInfo(metric) {
    if (!metric) return;

    const statusValue =
        metric.status || calculateStatus(metric);

    document.getElementById('diskUsage')
        .innerText =
        `Disk Usage: ${metric.diskUsage}%`;

    document.getElementById('serverIp')
        .innerText =
        `IP: ${metric.ipAddress ?? 'Unknown'}`;

    const status =
        document.getElementById('serverStatus');

    status.innerText =
        `STATUS: ${statusValue}`;

    status.className =
        `status ${statusValue.toLowerCase()}`;
}

socket.onopen = () => {

    socket.send(JSON.stringify({
        type: "frontend_register"
    }));
};

socket.onmessage = (event) => {

    const data =
        JSON.parse(event.data);

    if (data.type === "initial_metrics") {

        data.payload.forEach(rawMetric => {

            const metric =
                normalizeMetric(rawMetric);

            addServerOption(metric.hostname);

            addMetric(metric);
        });

        saveMetrics();

        const firstServer =
            Object.keys(serverMetrics)[0];

        restoreSelectedServer();

        if (
            !serverSelect.value &&
            firstServer
        ) {
            serverSelect.value = firstServer;
        }

        renderSelectedServer();
    }

    if (data.type === "metrics_update") {

        const metric =
            normalizeMetric(data.payload);
        const key =
            serverKey(metric.hostname);

        addServerOption(metric.hostname);

        const metrics =
            addMetric(metric);

        saveMetrics();

        if (!serverSelect.value) {
            serverSelect.value = key;
            saveSelectedServer();
        }

        if (serverSelect.value === key) {

            updateCharts(
                metrics
            );

            updateInfo(metric);
        }
    }
};

serverSelect.addEventListener('change', () => {

    const metrics =
        serverMetrics[serverSelect.value];

    if (!metrics) return;

    saveSelectedServer();
    renderSelectedServer();
});

restoreMetrics();
