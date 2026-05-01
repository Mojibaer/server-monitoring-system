// ۱. ابتدا تعریف سوکت
const socket = new WebSocket('ws://localhost:8081');

// ۲. تنظیم رویدادهای سوکت
socket.onopen = () => {
    console.log("Connected to WebSocket Server! ");
};

socket.onerror = (error) => {
    console.error("WebSocket Error: ", error);
};


const cpuCtx = document.getElementById('cpuChart').getContext('2d');
const ramCtx = document.getElementById('ramChart').getContext('2d');

const cpuChart = new Chart(cpuCtx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'CPU Usage (%)',
            data: [],
            borderColor: '#4caf50',
            tension: 0.1
        }]
    }
});

const ramChart = new Chart(ramCtx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'RAM Usage (%)',
            data: [],
            borderColor: '#2196f3',
            tension: 0.1
        }]
    }
});


socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log("Data received:", data);
    
    if (data.cpuUsage !== undefined) {
        const time = new Date().toLocaleTimeString();

        updateChart(cpuChart, time, data.cpuUsage);
        updateChart(ramChart, time, data.ramUsage);
        
        document.getElementById('diskUsage').innerText = `Disk Usage: ${data.diskUsage}%`;
        
        if (data.processes) {
            updateProcessTable(data.processes);
        }
    }
};


function updateChart(chart, label, value) {
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(value);
    if (chart.data.labels.length > 10) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
    }
    chart.update();
}

function updateProcessTable(processes) {
    const tbody = document.querySelector('#processTable tbody');
    tbody.innerHTML = '';
    processes.forEach(proc => {
        const row = `<tr><td>${proc.name || 'Unknown'}</td><td>${proc.memory || 0}%</td></tr>`;
        tbody.innerHTML += row;
    });
}