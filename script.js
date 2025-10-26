/*
 * script.js
 *
 * This script powers the main plotting page (index.html). It pulls
 * CSV data and heating selections from localStorage (populated by
 * data_script.js), parses the data with PapaParse, converts it into
 * a structure keyed by motor number, and then dynamically builds
 * interactive controls and a Plotly chart. Selecting motors and
 * adjusting the date/time range will redraw the chart and update the
 * availability and diesel saving metrics beneath it.
 */

(function () {

  // Global variables for diesel price (R$ per litre) and consumption (L per hour)
  let dieselPrice = 5.30;
  let dieselConsumption = 6.30;
  /**
   * Convert a date and time string into a JavaScript timestamp.
   * The date may come in dd/mm/yy or mm/dd/yy format. To infer
   * which is which, when the second part is greater than 12 it is
   * assumed to be the day. Year values less than 100 are treated as
   * 2000+year.
   *
   * @param {string} dateStr
   * @param {string} timeStr
   * @returns {number|null} timestamp in milliseconds or null on failure
   */
  function parseTimestamp(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    const parts = dateStr.split(/[\/\-]/);
    if (parts.length < 3) return null;
    let p1 = parseInt(parts[0], 10);
    let p2 = parseInt(parts[1], 10);
    let p3 = parseInt(parts[2], 10);
    if (isNaN(p1) || isNaN(p2) || isNaN(p3)) return null;
    let day, month, year;
    if (p2 > 12 && p1 <= 12) {
      // mm/dd/yy
      month = p1;
      day = p2;
      year = p3;
    } else if (p1 > 12 && p2 <= 12) {
      // dd/mm/yy
      day = p1;
      month = p2;
      year = p3;
    } else {
      // ambiguous, default mm/dd/yy
      month = p1;
      day = p2;
      year = p3;
    }
    if (year < 100) {
      year += 2000;
    }
    const iso = `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${timeStr.trim()}`;
    const d = new Date(iso);
    const t = d.getTime();
    return isNaN(t) ? null : t;
  }

  /**
   * Pad a number with a leading zero if necessary.
   *
   * @param {number} n
   * @returns {string}
   */
  function pad(n) {
    return n.toString().padStart(2, '0');
  }

  /**
   * Parse a CSV text into an array of objects. This uses PapaParse in
   * synchronous mode. Empty strings or invalid CSV return an empty
   * array.
   *
   * @param {string} csvText
   * @returns {Array<object>}
   */
  function parseCSV(csvText) {
    if (!csvText) return [];
    try {
      const parsed = Papa.parse(csvText.trim(), {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false
      });
      return Array.isArray(parsed.data) ? parsed.data : [];
    } catch (ex) {
      console.error('Erro ao analisar CSV:', ex);
      return [];
    }
  }

  /**
   * Build the motor data structure from an array of parsed CSV tables.
   *
   * @param {Array<Array<object>>} tables
   * @returns {{ motorData: object, minTime: number, maxTime: number }}
   */
  function buildDataStructure(tables) {
    const motorData = {};
    let minTime = Infinity;
    let maxTime = -Infinity;
    tables.forEach(table => {
      table.forEach(row => {
        // The date/time columns may begin with a dollar sign depending on export
        const dateStr = row['$Date'] || row['Date'] || row['Data'] || row['data'] || '';
        const timeStr = row['$Time'] || row['Time'] || row['Hora'] || row['hora'] || '';
        const ts = parseTimestamp(dateStr, timeStr);
        if (ts === null) return;
        if (ts < minTime) minTime = ts;
        if (ts > maxTime) maxTime = ts;
        Object.keys(row).forEach(col => {
          // Skip non-motor columns
          if (/\$?(Date|Time|Data|Hora)/i.test(col)) return;
          const cell = row[col];
          if (cell === undefined || cell === null || cell === '') return;
          // Convert value string to float, swapping comma for decimal point
          const value = parseFloat(String(cell).replace(',', '.'));
          if (isNaN(value)) return;
          // Extract motor number: SCA071TE402PV => 07
          const match = col.match(/SCA(\d{2})/i);
          if (!match) return;
          const motorId = parseInt(match[1], 10);
          if (!motorData[motorId]) motorData[motorId] = [];
          motorData[motorId].push({ t: ts, value: value });
        });
      });
    });
    // Sort each motor's data by timestamp
    Object.keys(motorData).forEach(key => {
      motorData[key].sort((a, b) => a.t - b.t);
    });
    return { motorData, minTime, maxTime };
  }

  /**
   * Compute metrics for a given motor within a time range.
   *
   * @param {Array<{t:number,value:number}>} dataArr
   * @param {number} startTime
   * @param {number} endTime
   * @returns {{ availability: string, economiaLitros: number, economiaRS: number, economiaMes: number, lastTemperature: number|null }}
   */
  function computeMetrics(dataArr, startTime, endTime) {
    if (!Array.isArray(dataArr) || dataArr.length === 0) {
      return {
        availability: '00:00 h',
        economiaLitros: 0,
        economiaRS: 0,
        economiaMes: 0,
        lastTemperature: null
      };
    }
    // Filter data points within range
    const filtered = dataArr.filter(p => p.t >= startTime && p.t <= endTime);
    if (filtered.length === 0) {
      return {
        availability: '00:00 h',
        economiaLitros: 0,
        economiaRS: 0,
        economiaMes: 0,
        lastTemperature: null
      };
    }
    let availabilityMs = 0;
    let economiaMs = 0;
    let prev = filtered[0];
    for (let i = 1; i < filtered.length; i++) {
      const curr = filtered[i];
      const dt = curr.t - prev.t;
      if (prev.value > 50 && curr.value > 50) {
        availabilityMs += dt;
      }
      if (prev.value > 40 && curr.value > 40) {
        economiaMs += dt;
      }
      prev = curr;
    }
    const availHrs = availabilityMs / 3600000;
    const availHours = Math.floor(availHrs);
    const availMinutes = Math.floor((availHrs - availHours) * 60);
    const availability = `${String(availHours).padStart(2, '0')}:${String(availMinutes).padStart(2, '0')} h`;
    // Compute savings based on dynamic diesel consumption and price
    const economiaLitros = (economiaMs / 3600000) * dieselConsumption;
    const economiaRS = economiaLitros * dieselPrice;
    // Monthly projection: multiply by 30 (days) according to spec
    const economiaMes = economiaRS * 30;
    const lastTemperature = filtered[filtered.length - 1].value;
    return { availability, economiaLitros, economiaRS, economiaMes, lastTemperature };
  }

  /**
   * Render the buttons used to toggle each motor series on or off.
   *
   * @param {object} motorData
   * @param {string[]} colors
   */
  function renderMotorButtons(motorData, colors) {
    const container = document.getElementById('motorButtons');
    container.innerHTML = '';
    for (let motorId = 1; motorId <= 23; motorId++) {
      const btn = document.createElement('button');
      btn.className = 'motor-button';
      btn.textContent = `Motor#${motorId}`;
      btn.dataset.motor = motorId;
      const color = colors[motorId - 1];
      btn.style.background = color;
      // Disable button if no data
      if (!motorData[motorId] || motorData[motorId].length === 0) {
        btn.disabled = true;
        btn.style.opacity = 0.4;
      }
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        btn.classList.toggle('active');
        updateChart();
      });
      container.appendChild(btn);
    }
  }

  /**
   * Build the Plotly chart based on selected motors and time range.
   */
  function updateChart() {
    const startInput = document.getElementById('startTime');
    const endInput = document.getElementById('endTime');
    const startTime = new Date(startInput.value).getTime();
    const endTime = new Date(endInput.value).getTime();
    const selectedButtons = Array.from(document.querySelectorAll('.motor-button.active'));
    const selectedMotors = selectedButtons.map(btn => parseInt(btn.dataset.motor, 10));
    // Build traces
    const traces = [];
    // Horizontal limit line at 50°C
    if (startTime && endTime) {
      traces.push({
        x: [new Date(startTime), new Date(endTime)],
        y: [50, 50],
        type: 'scatter',
        mode: 'lines',
        name: '',
        line: { color: '#ff4d4d', width: 1, dash: 'dot' },
        hovertemplate: 'Temp. mínima para partida<extra></extra>',
        showlegend: false
      });
    }
    selectedMotors.forEach(motorId => {
      const dataArr = motorData[motorId] || [];
      // Filter points within range
      const x = [];
      const y = [];
      for (const point of dataArr) {
        if (point.t >= startTime && point.t <= endTime) {
          x.push(new Date(point.t));
          y.push(point.value);
        }
      }
      traces.push({
        x: x,
        y: y,
        type: 'scatter',
        mode: 'lines',
        name: `UG#${pad(motorId)}`,
        line: { color: colors[motorId - 1], width: 2 },
        hovertemplate: `<b>UG#${pad(motorId)}</b><br>%{x|%d/%m/%y %H:%M}<br>%{y:.1f}°C<extra></extra>`
      });
    });
    const layout = {
      xaxis: {
        title: '',
        type: 'date',
        range: [new Date(startTime), new Date(endTime)],
        showgrid: true,
        gridcolor: '#333',
        tickfont: { color: '#bbb' }
      },
      yaxis: {
        title: 'Temperatura (°C)',
        range: [20, 80],
        showgrid: true,
        gridcolor: '#333',
        tickfont: { color: '#bbb' }
      },
      margin: { t: 10, r: 10, b: 50, l: 60 },
      plot_bgcolor: '#080808',
      paper_bgcolor: '#080808',
      font: { color: '#f5f5f5' },
      hovermode: 'closest'
    };
    Plotly.newPlot('chart', traces, layout, { responsive: true });
    updateMetrics(startTime, endTime, selectedMotors);
  }

  /**
   * Update the metrics cards based on selected motors and time range.
   *
   * @param {number} startTime
   * @param {number} endTime
   * @param {Array<number>} selectedMotors
   */
  function updateMetrics(startTime, endTime, selectedMotors) {
    const container = document.getElementById('metricsContainer');
    container.innerHTML = '';
    selectedMotors.forEach(motorId => {
      const dataArr = motorData[motorId] || [];
      const { availability, economiaLitros, economiaRS, economiaMes, lastTemperature } = computeMetrics(dataArr, startTime, endTime);
      const color = colors[motorId - 1];
      const imgSrc = (lastTemperature !== null && lastTemperature >= 50) ? 'Genset_Verde.png' : 'Genset_Vermelho.png';
      const card = document.createElement('div');
      card.className = 'metric-card';
      card.style.borderTopColor = color;
      const img = document.createElement('img');
      img.src = imgSrc;
      img.alt = (lastTemperature !== null && lastTemperature >= 50) ? 'Motor acima de 50°C' : 'Motor abaixo de 50°C';
      const info = document.createElement('div');
      info.className = 'metric-info';
      const title = document.createElement('h3');
      title.textContent = `UG#${pad(motorId)}`;
      const p1 = document.createElement('p');
      p1.textContent = `Disponibilidade: ${availability}`;
      info.appendChild(title);
      info.appendChild(p1);
      // If the motor is marked as having electric heating, show full economy data
      const isHeating = heatingData && heatingData[motorId];
      if (isHeating) {
        const p2 = document.createElement('p');
        p2.textContent = `Economia diesel: ${economiaLitros.toFixed(2)} L`;
        const p3 = document.createElement('p');
        p3.textContent = `Economia diesel: R$ ${economiaRS.toFixed(2)}`;
        const p4 = document.createElement('p');
        p4.textContent = `Projeção economia mensal: R$ ${economiaMes.toFixed(2)}`;
        info.appendChild(p2);
        info.appendChild(p3);
        info.appendChild(p4);
      }
      card.appendChild(img);
      card.appendChild(info);
      container.appendChild(card);
    });
    // After updating per-motor cards, update the summary panel at the top
    updateSummaryPanel(startTime, endTime);
  }

  /**
   * Update the summary panel with aggregated statistics for motors
   * marked as having electric heating. Also includes a monthly
   * projection across all motors. The summary panel lives in the
   * header and is rebuilt whenever the date range changes or data
   * loads.
   *
   * @param {number} startTime
   * @param {number} endTime
   */
  function updateSummaryPanel(startTime, endTime) {
    const panel = document.getElementById('summaryPanel');
    if (!panel) return;
    // Determine which motors are flagged as having electric heating
    const heatingMotors = [];
    for (let motorId = 1; motorId <= 23; motorId++) {
      if (heatingData && heatingData[motorId]) {
        // Only include if we have data for the motor
        if (motorData[motorId] && motorData[motorId].length > 0) {
          heatingMotors.push(motorId);
        }
      }
    }
    // Compute aggregated economy for heating motors
    let totalLitrosHeating = 0;
    let totalRSHeating = 0;
    heatingMotors.forEach(motorId => {
      const metrics = computeMetrics(motorData[motorId], startTime, endTime);
      totalLitrosHeating += metrics.economiaLitros;
      totalRSHeating += metrics.economiaRS;
    });
    // Compute monthly projection for all motors across the selected range
    let totalMonthlyProjection = 0;
    for (let motorId = 1; motorId <= 23; motorId++) {
      if (motorData[motorId] && motorData[motorId].length > 0) {
        const metrics = computeMetrics(motorData[motorId], startTime, endTime);
        totalMonthlyProjection += metrics.economiaMes;
      }
    }
    // Build HTML for the summary panel
    const items = [];
    // Line 1: heating motors list
    const motorsListText = heatingMotors.length > 0 ?
      heatingMotors.map(id => `Motor#${pad(id)}`).join(', ') : 'Nenhum motor com aquecedor';
    items.push(`<div class="summary-item"><span class="emoji">🔌</span><span><strong>Motores com aquecedor elétrico:</strong> ${motorsListText}</span></div>`);
    // Line 2: total economy diesel (liters)
    items.push(`<div class="summary-item"><span class="emoji">⛽</span><span><strong>Economia diesel (L):</strong> ${totalLitrosHeating.toFixed(2)} L</span></div>`);
    // Line 3: total economy diesel in local currency
    items.push(`<div class="summary-item"><span class="emoji">💰</span><span><strong>Economia diesel (R$):</strong> R$ ${totalRSHeating.toFixed(2)}</span></div>`);
    // Line 4: monthly projection across all motors
    items.push(`<div class="summary-item"><span class="emoji">📅</span><span><strong>Projeção economia mensal:</strong> R$ ${totalMonthlyProjection.toFixed(2)}</span></div>`);
    // Line 5: observation about projection
    items.push(`<div class="summary-item" style="font-size:0.7rem;"><span class="emoji">ℹ️</span><span>Projeção baseada no intervalo selecionado</span></div>`);
    panel.innerHTML = items.join('');
  }

  // Global variables to hold processed data, colour palette and heating info
  let motorData = {};
  let colors = [];
  let heatingData = {};

  /**
   * Initialise the page. Parse CSV from localStorage and prepare UI.
   */
  function init() {
    const hasData = localStorage.getItem('hasData');
    const messageEl = document.getElementById('message');
    const mainEl = document.getElementById('mainContent');
    if (!hasData) {
      messageEl.style.display = 'block';
      messageEl.textContent = 'Nenhum dado encontrado. Vá para a página de entrada de dados para carregar arquivos CSV.';
      mainEl.style.display = 'none';
      return;
    }
    // Retrieve CSV texts from localStorage
    const csvTexts = [];
    ['group1', 'group2', 'group3', 'group4'].forEach(key => {
      const txt = localStorage.getItem(key) || '';
      if (txt && txt.trim().length > 0) {
        csvTexts.push(txt);
      }
    });
    if (csvTexts.length === 0) {
      messageEl.style.display = 'block';
      messageEl.textContent = 'Os arquivos CSV fornecidos estavam vazios. Volte à página de entrada de dados para carregar arquivos válidos.';
      mainEl.style.display = 'none';
      return;
    }
    // Parse each CSV into arrays
    const parsedTables = csvTexts.map(t => parseCSV(t));
    // Build data structure
    const { motorData: md, minTime, maxTime } = buildDataStructure(parsedTables);
    motorData = md;
    // Load heating selections from localStorage
    try {
      const heatingStr = localStorage.getItem('heating');
      heatingData = heatingStr ? JSON.parse(heatingStr) : {};
    } catch (ex) {
      heatingData = {};
    }

    // Load diesel price and consumption from localStorage if available
    const storedPrice = parseFloat(localStorage.getItem('dieselPrice'));
    const storedConsumption = parseFloat(localStorage.getItem('dieselConsumption'));
    if (!isNaN(storedPrice)) {
      dieselPrice = storedPrice;
    }
    if (!isNaN(storedConsumption)) {
      dieselConsumption = storedConsumption;
    }
    // Update footer display values to reflect the current configuration
    const priceDisplay = document.getElementById('dieselPriceDisplay');
    const consDisplay = document.getElementById('dieselConsumptionDisplay');
    if (priceDisplay) {
      priceDisplay.textContent = dieselPrice.toFixed(2);
    }
    if (consDisplay) {
      consDisplay.textContent = dieselConsumption.toFixed(2);
    }
    // Generate a colour palette of 23 distinct colours
    colors = [
      '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f',
      '#bcbd22', '#17becf', '#393b79', '#637939', '#8c6d31', '#e7ba52', '#31a354', '#3182bd',
      '#756bb1', '#b94b43', '#6b6ecf', '#9c9ede', '#636363', '#e6550d', '#a55194'
    ];
    // Populate motor buttons
    renderMotorButtons(motorData, colors);
    // Set time inputs to the min and max timestamps
    const startInput = document.getElementById('startTime');
    const endInput = document.getElementById('endTime');
    const dtToLocalValue = (ms) => {
      const d = new Date(ms);
      // Format as YYYY-MM-DDTHH:MM (omit seconds)
      const yyyy = d.getFullYear().toString().padStart(4, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    };
    startInput.value = dtToLocalValue(minTime);
    endInput.value = dtToLocalValue(maxTime);
    // Show main content now that data is ready
    messageEl.style.display = 'none';
    mainEl.style.display = 'block';
    // Attach updateRange button
    document.getElementById('updateRange').addEventListener('click', () => {
      updateChart();
    });
    // Optionally select the first motor by default for a preview
    const firstBtn = document.querySelector('.motor-button:not([disabled])');
    if (firstBtn) {
      firstBtn.classList.add('active');
    }
    // Draw initial chart
    updateChart();
  }

  // Kick things off when DOM is ready
  document.addEventListener('DOMContentLoaded', init);
})();