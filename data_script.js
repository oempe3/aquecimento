/*
 * data_script.js
 *
 * This script powers the data entry page (data.html). It dynamically
 * creates checkboxes for each of the 23 motors, reads the user
 * supplied CSV files when the “Carregar e Plotar” button is pressed,
 * and stores both the CSV contents and the selected heating flags
 * into localStorage. Once the data has been stored the page
 * redirects the visitor to index.html where the graph is rendered.
 */

document.addEventListener('DOMContentLoaded', () => {
  const heatingListEl = document.getElementById('heatingList');

  // On page load, set the displayed diesel price and consumption values based on localStorage if available
  (function updateDieselDisplay() {
    const priceSpan = document.getElementById('dieselPriceDisplayData');
    const consSpan = document.getElementById('dieselConsumptionDisplayData');
    // Check localStorage for stored values
    const storedPrice = parseFloat(localStorage.getItem('dieselPrice'));
    const storedConsumption = parseFloat(localStorage.getItem('dieselConsumption'));
    if (priceSpan) {
      if (!isNaN(storedPrice)) {
        priceSpan.textContent = storedPrice.toFixed(2);
      } else {
        priceSpan.textContent = priceSpan.textContent || '5.30';
      }
    }
    if (consSpan) {
      if (!isNaN(storedConsumption)) {
        consSpan.textContent = storedConsumption.toFixed(2);
      } else {
        consSpan.textContent = consSpan.textContent || '6.30';
      }
    }
  })();

  // Generate checkboxes for UG#01 … UG#23
  for (let motorId = 1; motorId <= 23; motorId++) {
    const padded = motorId.toString().padStart(2, '0');
    const container = document.createElement('div');
    container.className = 'heating-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `heat${motorId}`;
    checkbox.dataset.motor = motorId;

    const label = document.createElement('label');
    label.htmlFor = `heat${motorId}`;
    label.textContent = `UG#${padded}`;

    container.appendChild(checkbox);
    container.appendChild(label);
    heatingListEl.appendChild(container);
  }

  document.getElementById('submitData').addEventListener('click', () => {
    // Retrieve files
    const fileInputs = ['group1', 'group2', 'group3', 'group4'];
    const files = {};
    fileInputs.forEach(id => {
      const input = document.getElementById(id);
      files[id] = input.files.length > 0 ? input.files[0] : null;
    });

    // If no files were provided at all we alert the user
    const hasAnyFile = Object.values(files).some(f => f !== null);
    if (!hasAnyFile) {
      alert('Por favor, selecione pelo menos um arquivo CSV para carregar.');
      return;
    }

    // Read each file as text. Because FileReader is asynchronous
    // we count pending reads and trigger proceed() once all complete.
    const results = {};
    let pending = 0;

    function readerLoaded(key, e) {
      results[key] = e.target.result;
      pending--;
      if (pending === 0) {
        proceed();
      }
    }

    function proceed() {
      // Persist CSV contents into localStorage. Empty strings for missing files.
      Object.keys(files).forEach(id => {
        const content = results[id] || '';
        try {
          localStorage.setItem(id, content);
        } catch (ex) {
          console.error('Erro ao armazenar arquivo no localStorage', ex);
        }
      });
      // Persist heating selections
      const heating = {};
      for (let motorId = 1; motorId <= 23; motorId++) {
        const chk = document.getElementById(`heat${motorId}`);
        heating[motorId] = chk.checked;
      }
      try {
        localStorage.setItem('heating', JSON.stringify(heating));
      } catch (ex) {
        console.error('Erro ao armazenar dados de aquecimento', ex);
      }

      // Persist diesel price and consumption values
      const priceInput = document.getElementById('dieselPrice');
      const consumptionInput = document.getElementById('dieselConsumption');
      const priceVal = parseFloat(priceInput.value);
      const consVal = parseFloat(consumptionInput.value);
      try {
        if (!isNaN(priceVal)) {
          localStorage.setItem('dieselPrice', priceVal.toString());
        }
        if (!isNaN(consVal)) {
          localStorage.setItem('dieselConsumption', consVal.toString());
        }
      } catch (ex) {
        console.error('Erro ao armazenar dados de diesel', ex);
      }
      localStorage.setItem('hasData', 'true');
      // Navigate to the plotting page
      window.location.href = 'index.html';
    }

    Object.keys(files).forEach(key => {
      const file = files[key];
      if (file) {
        pending++;
        const reader = new FileReader();
        reader.onload = (e) => readerLoaded(key, e);
        reader.onerror = () => {
          alert(`Erro ao ler o arquivo ${file.name}`);
          results[key] = '';
          pending--;
          if (pending === 0) proceed();
        };
        reader.readAsText(file);
      } else {
        results[key] = '';
      }
    });

    // If no pending readers (all files empty) proceed immediately.
    if (pending === 0) {
      proceed();
    }
  });
});