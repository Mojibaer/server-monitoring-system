const socket = new WebSocket('ws://localhost:8081');
const serverList = new Set();
let currentServer = "";

socket.onopen = () => {
    console.log("Connected to WebSocket Server!");
    
    socket.send(JSON.stringify({ type: "frontend_register" }));
};

socket.onerror = (error) => {
    console.error("WebSocket Error: ❌", error);
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
            tension: 0.1,
            fill: true
        }]
    },
    options: {
        animation: false,
        responsive: true,
        scales: { 
            y: { beginAtZero: true, max: 100 } 
        }
    }
});

const cpuChart = new Chart(cpuCtx, chartConfig('CPU Usage (%)', '#4caf50'));
const ramChart = new Chart(ramCtx, chartConfig('RAM Usage (%)', '#2196f3'));


document.getElementById('serverSelect').addEventListener('change', (e) => {
    currentServer = e.target.value;
    
    
    cpuChart.data.labels = [];
    cpuChart.data.datasets[0].data = [];
    ramChart.data.labels = [];
    ramChart.data.datasets[0].data = [];
    
    cpuChart.update();
    ramChart.update();
    
    document.getElementById('diskUsage').innerText = "Disk Usage: Selecting...";
    document.getElementById('serverIp').innerText = "";
});

socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    
    if (data.type === "initial_metrics") {
        data.payload.forEach(m => {
            addServerToList(m.hostname);
            
            
            if (currentServer === m.hostname) {
                const time = new Date().toLocaleTimeString();
                updateChart(cpuChart, time, m.cpuUsage);
                updateChart(ramChart, time, m.ramUsage);
            }
        });
    }

    
    if (data.type === "metrics_update") {
        const m = data.payload;
        addServerToList(m.hostname);

        
        if (currentServer === m.hostname) {
            const time = new Date().toLocaleTimeString();
            
            updateChart(cpuChart, time, m.cpuUsage);
            updateChart(ramChart, time, m.ramUsage);
            
            document.getElementById('diskUsage').innerText = `Disk Usage: ${m.diskUsage}%`;
            document.getElementById('serverIp').innerText = `IP: ${m.ipAddress || 'N/A'}`;
            
            if (m.processes) {
                updateProcessTable(m.processes);
            }
        }
    }
};


function addServerToList(hostname) {
    if (hostname && !serverList.has(hostname)) {
        serverList.add(hostname);
        const select = document.getElementById('serverSelect');
        const option = new Option(hostname, hostname);
        select.add(option);
    }
}


function updateChart(chart, label, value) {
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(value);
    
    
    if (chart.data.labels.length > 20) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
    }
    chart.update();
}


function updateProcessTable(processes) {
    const tbody = document.querySelector('#processTable tbody');
    tbody.innerHTML = '';
    
    
    processes.slice(0, 10).forEach(proc => {
        const row = `<tr>
            <td>${proc.name || 'Unknown'}</td>
            <td>${proc.memory || 0}%</td>
        </tr>`;
        tbody.innerHTML += row;
    });
}