# Lightweight Server Monitoring System

## Overview

A lightweight server monitoring system with agent-based data collection like Nagios but in 
a smaller scope fit for the objective of this class. A Linux-based Python agent collects 
system metrics such as CPU usage, memory consumption, and running processes, disk 
usage and sends them to a central backend service. The backend provides Web/REST APIs 
for data access, real-time updates via WebSockets, and authenticated access to server 
status information. 

---

## Team Responsibilities

- Vodopianova Alena – WebSocket communication
- Arjmand Helma – Frontend page
- Masir Ahmad – Backend development and database
- Derman Rifat – Python monitoring script and documentation

---

## Features

The system focuses on a minimal demo setup and collects the following metrics:

- CPU usage
- RAM usage
- Disk space usage

Additional functions:

- Live system updates
- Historical data storage
- Simple web interface
- Authenticated access (basic concept)

---

## Technology Stack

### Agent
**Python**

Used to collect system metrics on Linux systems.  
Python is lightweight, widely supported, and ideal for scripting tasks.

### Backend
**Node.js + Express / Fastify**

Handles incoming monitoring data, API requests, authentication, and communication with clients.

### Database
**SQLite**

A lightweight file-based database used for storing monitoring history.

### Frontend
**HTML + Vanilla JavaScript**

Simple dashboard interface for displaying server status and live values.

### Communication Technologies

#### WebSocket

Used for real-time communication between backend and frontend clients.

#### REST API

Used for:

- requesting historical data
- authentication
- configuration requests
- standard backend access

---

## Data Flow

1. The Python agent collects system metrics every minute.
2. The collected data is sent to the backend.
3. The backend processes and stores the data in SQLite.
4. Connected frontend clients receive live updates through WebSocket.
5. Historical data can be requested through REST API endpoints.

---

## Design Goals

The system was designed with the following goals:

- minimal complexity
- easy deployment
- low resource usage
- clear architecture
- suitable for classroom demonstration

---
