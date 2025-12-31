# 🚀 CodeQuery

A high-performance, lightweight search utility built with Flask that allows users to query and retrieve programming solutions from a structured JSON dataset through a responsive web interface.

---

<div align="left">
  <img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/Flask-000000?style=for-the-badge&logo=flask&logoColor=white" />
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" />
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" />
  <img src="https://img.shields.io/badge/JSON-000000?style=for-the-badge&logo=json&logoColor=white" />
</div>

---

### 📌 Overview
**CodeQuery** serves as a localized knowledge base for developers. It bridges the gap between static data and user accessibility by providing a searchable frontend for a local repository of technical questions and code snippets.

### 🛠️ Technical Stack
| Component | Technology |
| :--- | :--- |
| **Backend** | Flask |
| **Frontend** | HTML5, CSS3 (Vanilla) |
| **Data Engine** | JSON-based flat-file storage |
| **Routing** | Flask Application Factory |

---

### ✨ Key Features
- **Instant Retrieval:** Parses and filters `questions.json` in real-time to provide fast results.
- **Responsive Layout:** Optimized for various screen sizes using modern CSS principles.
- **Code Highlighting Support:** Structured to display complex code blocks with clarity.
- **Zero Configuration:** Runs locally with minimal setup—no external database like MySQL/PostgreSQL required.

---

### 📂 Project Structure
```text
Codequery/
├── app.py              # Core application logic and routing
├── questions.json      # Local data repository (Questions & Solutions)
├── static/             
│   └── style.css       # Frontend UI styling
└── templates/          
    └── index.html      # Main user interface template
