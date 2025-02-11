var visit = document.getElementById('visit');

// Retrieve previous visit count from localStorage
var visitcount = localStorage.getItem('visitcount') ? parseInt(localStorage.getItem('visitcount')) : 0;

// Increment and update the UI
visitcount += 1;
visit.innerText = visitcount;

// Save the updated count back to localStorage
localStorage.setItem('visitcount', visitcount);


document.getElementById('downloadBtn').addEventListener('click', function () {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    let text = document.getElementById('textInput').value;
    const fontSize = document.getElementById('fontSize').value;
    const fontStyle = document.getElementById('fontStyle').value;
    const fontFamily = document.getElementById('fontFamily').value;

    // Replace special characters
    text = text.replace(/≤/g, '<=')
               .replace(/≥/g, '>=')
               .replace(/≠/g, '!=')
               .replace(/±/g, '+/-')
               .replace(/µ/g, 'u')
               .replace(/°/g, 'deg')
               .replace(/∞/g, 'infinity')
               .replace(/√/g, 'sqrt')
               .replace(/∑/g, 'sum')
               .replace(/π/g, 'pi');

    // Format text for bold, italic, and underline
    text = text.replace(/\*(.*?)\*/g, function(match, p1) {
        return `<b>${p1}</b>`;
    }).replace(/_(.*?)_/g, function(match, p1) {
        return `<i>${p1}</i>`;
    }).replace(/~(.*?)~/g, function(match, p1) {
        return `<u>${p1}</u>`;
    });
    

    doc.setFontSize(fontSize);
    doc.setFont(fontFamily, fontStyle);

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;
    const textWidth = pageWidth - margin * 2;
    const lines = doc.splitTextToSize(text, textWidth);

    let y = margin;
    lines.forEach(line => {
        if (y + fontSize / 2 > doc.internal.pageSize.getHeight() - margin) {
            doc.addPage();
            y = margin;
        }
        doc.text(line, margin, y);
        y += fontSize / 2;
    });

    // Generate file name
    const fileName = text.substring(0, 10).replace(/\s+/g, '_') + '.pdf';
    doc.save(fileName);
});

document.getElementById('shareBtn').addEventListener('click', function () {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    let text = document.getElementById('textInput').value;
    const fontSize = document.getElementById('fontSize').value;
    const fontStyle = document.getElementById('fontStyle').value;
    const fontFamily = document.getElementById('fontFamily').value;

    // Replace special characters
    text = text.replace(/≤/g, '<=')
               .replace(/≥/g, '>=')
               .replace(/≠/g, '!=')
               .replace(/±/g, '+/-')
               .replace(/µ/g, 'u')
               .replace(/°/g, 'deg')
               .replace(/∞/g, 'infinity')
               .replace(/√/g, 'sqrt')
               .replace(/∑/g, 'sum')
               .replace(/π/g, 'pi');

    // Format text for bold, italic, and underline
    text = text.replace(/\*(.*?)\*/g, function(match, p1) {
        return `<b>${p1}</b>`;
    }).replace(/_(.*?)_/g, function(match, p1) {
        return `<i>${p1}</i>`;
    }).replace(/~(.*?)~/g, function(match, p1) {
        return `<u>${p1}</u>`;
    });
    

    doc.setFontSize(fontSize);
    doc.setFont(fontFamily, fontStyle);

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;
    const textWidth = pageWidth - margin * 2;
    const lines = doc.splitTextToSize(text, textWidth);

    let y = margin;
    lines.forEach(line => {
        if (y + fontSize / 2 > doc.internal.pageSize.getHeight() - margin) {
            doc.addPage();
            y = margin;
        }
        doc.text(line, margin, y);
        y += fontSize / 2;
    });

    // Generate file name
    const fileName = text.substring(0, 10).replace(/\s+/g, '_') + '.pdf';

    // Convert PDF to Blob
    const pdfBlob = doc.output('blob');

    // Share PDF
    if (navigator.share) {
        navigator.share({
            title: 'PDF Document',
            text: 'Check out this PDF document!',
            files: [new File([pdfBlob], fileName, { type: 'application/pdf' })]
        }).then(() => {
            console.log('PDF shared successfully!');
        }).catch(error => {
            console.error('Error sharing PDF:', error);
        });
    } else {
        alert('Sharing is not supported in this browser.');
    }
});
