const socket = new WebSocket('ws://localhost:8081');
 
const serverList = new Set();

let currentServer = "";
 
socket.onopen = () => {

    console.log("Connected to WebSocket Server! ✅");
 
    socket.send(JSON.stringify({

        type: "frontend_register"

    }));

};
 
socket.onerror = (error) => {

    console.error("WebSocket Error: ❌", error);

};
 
socket.onclose = () => {

    console.log("WebSocket disconnected ❌");

};
 
const cpuCtx = document.getElementById('cpuChart').getContext('2d');

const ramCtx = document.getElementById('ramChart').getContext('2d');
 
const chartConfig = (label, color) => ({

    type: 'line',

    data: {

        labels: [],

        datasets: [{

            label: label,

            data: [],

            borderColor: color,

            backgroundColor: color + '22',

            tension: 0.3,

            fill: true

        }]

    },

    options: {

        animation: false,

        responsive: true,

        scales: {

            y: {

                beginAtZero: true,

                max: 100

            }

        }

    }

});
 
const cpuChart = new Chart(cpuCtx, chartConfig('CPU Usage (%)', '#4caf50'));

const ramChart = new Chart(ramCtx, chartConfig('RAM Usage (%)', '#2196f3'));
 
const serverSelect = document.getElementById('serverSelect');
 
serverSelect.addEventListener('change', (e) => {

    currentServer = e.target.value;
 
    console.log("Switched to server:", currentServer);
 
    clearCharts();
 
    document.getElementById('serverIp').innerText = "";

    document.getElementById('diskUsage').innerText = "Disk Usage: Loading...";
 
    const tbody = document.querySelector('#processTable tbody');

    if (tbody) {

        tbody.innerHTML = '';

    }

});
 
socket.onmessage = (event) => {

    const data = JSON.parse(event.data);
 
    console.log("Data received:", data);
 
    // INITIAL METRICS FROM DATABASE

    if (data.type === "initial_metrics") {
 
        data.payload.forEach(m => {
 
            addServerToList(m.hostname);
 
            // AUTO SELECT FIRST SERVER

            if (!currentServer) {

                currentServer = m.hostname;

                serverSelect.value = m.hostname;

            }
 
            if (currentServer === m.hostname) {
 
                const time = generateTimeLabel();
 
                updateChart(cpuChart, time, m.cpuUsage);

                updateChart(ramChart, time, m.ramUsage);
 
                document.getElementById('diskUsage').innerText =

                    `Disk Usage: ${m.diskUsage}%`;
 
                document.getElementById('serverIp').innerText =

                    `IP: ${m.ipAddress || 'N/A'}`;
 
                if (m.processes) {

                    updateProcessTable(m.processes);

                }

            }

        });

    }
 
    // LIVE UPDATES

    if (data.type === "metrics_update") {
 
        const m = data.payload;
 
        addServerToList(m.hostname);
 
        console.log("CURRENT SERVER:", currentServer);

        console.log("MESSAGE SERVER:", m.hostname);
 
        if (currentServer === m.hostname) {
 
            const time = generateTimeLabel();
 
            updateChart(cpuChart, time, m.cpuUsage);

            updateChart(ramChart, time, m.ramUsage);
 
            document.getElementById('diskUsage').innerText =

                `Disk Usage: ${m.diskUsage}%`;
 
            document.getElementById('serverIp').innerText =

                `IP: ${m.ipAddress || 'N/A'}`;
 
            if (m.processes) {

                updateProcessTable(m.processes);

            }

        }

    }

};
 
function addServerToList(hostname) {
 
    if (hostname && !serverList.has(hostname)) {
 
        serverList.add(hostname);
 
        const option = new Option(hostname, hostname);
 
        serverSelect.add(option);
 
        // FIRST SERVER AUTO SELECT

        if (!currentServer) {

            currentServer = hostname;

            serverSelect.value = hostname;

        }

    }

}
 
function updateChart(chart, label, value) {
 
    console.log("Adding point:", label, value);
 
    chart.data.labels.push(label);

    chart.data.datasets[0].data.push(value);
 
    // KEEP ONLY LAST 20 POINTS

    if (chart.data.labels.length > 20) {

        chart.data.labels.shift();

        chart.data.datasets[0].data.shift();

    }
 
    chart.update();

}
 
function clearCharts() {
 
    cpuChart.data.labels = [];

    cpuChart.data.datasets[0].data = [];
 
    ramChart.data.labels = [];

    ramChart.data.datasets[0].data = [];
 
    cpuChart.update();

    ramChart.update();

}
 
function generateTimeLabel() {
 
    const now = new Date();
 
    return now.toLocaleTimeString([], {

        hour: '2-digit',

        minute: '2-digit',

        second: '2-digit'

    }) + ":" + now.getMilliseconds();

}
 
function updateProcessTable(processes) {
 
    const tbody = document.querySelector('#processTable tbody');
 
    if (!tbody) return;
 
    tbody.innerHTML = '';
 
    if (processes && Array.isArray(processes)) {
 
        processes.slice(0, 10).forEach(proc => {
 
            const row = `
<tr>
<td>${proc.name || 'Unknown'}</td>
<td>${proc.memory || 0}%</td>
</tr>

            `;
 
            tbody.innerHTML += row;

        });

    }

}
 