// Demo functionality for the File DB documentation site

class FileDBDemo {
  constructor() {
    // Use current host for demo
    const baseUrl = window.location.origin;
    this.client = new FileDB(baseUrl);
    this.currentFileId = null;
    this.currentFileName = null;
    this.currentUser = null;
    this.isAuthenticated = false;
    this.initializeEventListeners();
    this.checkAuthenticationState();
  }

  initializeEventListeners() {
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInput = document.getElementById('fileInput');
    const downloadBtn = document.getElementById('downloadBtn');
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');

    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => this.handleUpload());
    }

    if (fileInput) {
      fileInput.addEventListener('change', () => this.handleFileSelection());
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => this.handleDownload());
    }

    if (loginBtn) {
      loginBtn.addEventListener('click', () => this.handleLogin());
    }

    if (registerBtn) {
      registerBtn.addEventListener('click', () => this.handleRegister());
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.handleLogout());
    }

    if (loginTab) {
      loginTab.addEventListener('click', () => this.showLoginForm());
    }

    if (registerTab) {
      registerTab.addEventListener('click', () => this.showRegisterForm());
    }

    // Handle Enter key in auth forms
    ['loginEmail', 'loginPassword'].forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') this.handleLogin();
        });
      }
    });

    ['registerEmail', 'registerPassword'].forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') this.handleRegister();
        });
      }
    });
  }

  handleFileSelection() {
    const input = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');

    if (!this.isAuthenticated) {
      if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Please Login First';
      }
      return;
    }

    if (input.files && input.files[0]) {
      const file = input.files[0];
      const validation = FileDB.validateFile(file);

      if (validation.valid) {
        uploadBtn.disabled = false;
        uploadBtn.textContent = `Upload ${file.name}`;
        this.hideResults();
      } else {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Invalid File';
        this.showError(validation.errors.join(', '));
      }
    } else {
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Upload File';
    }
  }

  async handleUpload() {
    if (!this.isAuthenticated) {
      this.showError('Please login or register first to upload files');
      return;
    }

    const input = document.getElementById('fileInput');
    const file = input.files[0];

    if (!file) {
      this.showError('Please select a file first');
      return;
    }

    this.showUploading();

    try {
      const idempotencyKey = FileDB.generateIdempotencyKey();

      // Upload the file
      const result = await this.client.upload(file, {
        idempotencyKey: idempotencyKey,
        ttlDays: 7
      });

      this.currentFileId = result.file_id;
      this.currentFileName = file.name;

      // Get file info to verify upload
      const fileInfo = await this.client.getInfo(result.file_id);

      // Calculate chunk count (approximate)
      const chunkSize = 16 * 1024; // 16KB chunks
      const chunkCount = Math.ceil(file.size / chunkSize);

      this.showSuccess({
        fileId: result.file_id,
        fileSize: this.formatFileSize(file.size),
        chunkCount: chunkCount,
        fileType: file.type || 'application/octet-stream',
        originalFile: file,
        fileInfo: fileInfo
      });

    } catch (error) {
      this.showError(error.message);
    }
  }

  async handleDownload() {
    if (!this.currentFileId) {
      this.showError('No file to download');
      return;
    }

    try {
      await this.client.download(this.currentFileId, this.currentFileName || 'retrieved-file');
    } catch (error) {
      this.showError(`Download failed: ${error.message}`);
    }
  }

  showUploading() {
    this.hideResults();
    const status = document.getElementById('uploadStatus');
    const uploadBtn = document.getElementById('uploadBtn');

    status.classList.remove('hidden');
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
  }

  showSuccess(data) {
    const status = document.getElementById('uploadStatus');
    const result = document.getElementById('uploadResult');
    const uploadBtn = document.getElementById('uploadBtn');

    // Hide uploading status
    status.classList.add('hidden');

    // Show success result
    result.classList.remove('hidden');

    // Populate result data
    document.getElementById('fileId').textContent = data.fileId;
    document.getElementById('fileSize').textContent = data.fileSize;
    document.getElementById('chunkCount').textContent = data.chunkCount;
    document.getElementById('fileType').textContent = data.fileType;

    // Reset upload button
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload Another File';

    // Show file integrity comparison
    this.showIntegrityCheck(data.originalFile, data.fileInfo);
  }

  showError(message) {
    this.hideResults();
    const error = document.getElementById('errorResult');
    const uploadBtn = document.getElementById('uploadBtn');

    error.classList.remove('hidden');
    document.getElementById('errorMessage').textContent = message;

    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Try Again';
  }

  hideResults() {
    const status = document.getElementById('uploadStatus');
    const result = document.getElementById('uploadResult');
    const error = document.getElementById('errorResult');

    status.classList.add('hidden');
    result.classList.add('hidden');
    error.classList.add('hidden');
  }

  async showIntegrityCheck(originalFile, fileInfo) {
    try {
      // Compare file metadata for integrity check
      const originalSize = originalFile.size;
      const retrievedSize = fileInfo.total_size;
      const originalType = originalFile.type || 'application/octet-stream';
      const retrievedType = fileInfo.content_type;

      const sizeMatch = originalSize === retrievedSize;
      const typeMatch = originalType === retrievedType;
      const integrityMatch = sizeMatch && typeMatch;

      // Add integrity indicator to the result
      const resultDiv = document.getElementById('uploadResult');
      const integrityDiv = document.createElement('div');
      integrityDiv.className = `mt-2 p-2 rounded ${integrityMatch ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`;
      integrityDiv.innerHTML = `
        <div class="flex items-center text-sm">
          <span class="mr-2">${integrityMatch ? '✅' : '❌'}</span>
          <span>Integrity Check: ${integrityMatch ? 'PASSED' : 'FAILED'}</span>
        </div>
        <div class="text-xs mt-1 ml-6">
          <div>Size: ${originalSize} bytes → ${retrievedSize} bytes ${sizeMatch ? '✅' : '❌'}</div>
          <div>Type: ${originalType} → ${retrievedType} ${typeMatch ? '✅' : '❌'}</div>
          <div>Checksum: ${fileInfo.checksum ? fileInfo.checksum.substring(0, 16) + '...' : 'N/A'}</div>
        </div>
      `;

      resultDiv.appendChild(integrityDiv);
    } catch (error) {
      console.warn('Could not perform integrity check:', error);
    }
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Authentication methods
  checkAuthenticationState() {
    // Check if user is already authenticated (token stored locally)
    const storedToken = localStorage.getItem('filedb_access_token');
    if (storedToken) {
      this.client.setAccessToken(storedToken);
      this.verifyToken();
    } else {
      this.showAuthSection();
    }
  }

  async verifyToken() {
    try {
      const userInfo = await this.client.getMe();
      this.currentUser = userInfo.user;
      this.isAuthenticated = true;
      this.showUploadSection();
    } catch (error) {
      // Token is invalid, clear it and show auth
      localStorage.removeItem('filedb_access_token');
      this.client.setAccessToken(null);
      this.showAuthSection();
    }
  }

  async handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
      this.showAuthError('Please fill in all fields');
      return;
    }

    this.showAuthStatus();

    try {
      const result = await this.client.login(email, password);
      this.currentUser = result.user;
      this.isAuthenticated = true;
      
      // Store token for future sessions
      localStorage.setItem('filedb_access_token', result.accessToken);
      
      this.showUploadSection();
    } catch (error) {
      this.showAuthError(error.message);
    }
  }

  async handleRegister() {
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;

    if (!email || !password) {
      this.showAuthError('Please fill in all fields');
      return;
    }

    if (password.length < 6) {
      this.showAuthError('Password must be at least 6 characters long');
      return;
    }

    this.showAuthStatus();

    try {
      const result = await this.client.register(email, password, 'user');
      this.currentUser = result.user;
      this.isAuthenticated = true;
      
      // Store token for future sessions
      localStorage.setItem('filedb_access_token', result.accessToken);
      
      this.showUploadSection();
    } catch (error) {
      this.showAuthError(error.message);
    }
  }

  handleLogout() {
    this.currentUser = null;
    this.isAuthenticated = false;
    this.client.setAccessToken(null);
    localStorage.removeItem('filedb_access_token');
    this.showAuthSection();
    this.hideResults();
  }

  showLoginForm() {
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    loginTab.className = 'tab-button px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white';
    registerTab.className = 'tab-button px-4 py-2 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900';
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    this.hideAuthMessages();
  }

  showRegisterForm() {
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    registerTab.className = 'tab-button px-4 py-2 rounded-md text-sm font-medium bg-green-600 text-white';
    loginTab.className = 'tab-button px-4 py-2 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900';
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    this.hideAuthMessages();
  }

  showAuthSection() {
    document.getElementById('authSection').classList.remove('hidden');
    document.getElementById('userInfo').classList.add('hidden');
    document.getElementById('uploadSection').classList.add('hidden');
    this.clearAuthForms();
  }

  showUploadSection() {
    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('userInfo').classList.remove('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    document.getElementById('userEmail').textContent = this.currentUser.email;
    
    // Add fade-in animation
    const uploadSection = document.getElementById('uploadSection');
    const userInfo = document.getElementById('userInfo');
    uploadSection.classList.add('fade-in');
    userInfo.classList.add('fade-in');
    
    this.hideAuthMessages();
  }

  showAuthStatus() {
    this.hideAuthMessages();
    document.getElementById('authStatus').classList.remove('hidden');
  }

  showAuthError(message) {
    this.hideAuthMessages();
    document.getElementById('authError').classList.remove('hidden');
    document.getElementById('authErrorMessage').textContent = message;
  }

  hideAuthMessages() {
    document.getElementById('authStatus').classList.add('hidden');
    document.getElementById('authError').classList.add('hidden');
  }

  clearAuthForms() {
    ['loginEmail', 'loginPassword', 'registerEmail', 'registerPassword'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.value = '';
    });
    this.hideAuthMessages();
  }
}

// Initialize demo when DOM is loaded and FileDB is available
document.addEventListener('DOMContentLoaded', () => {
  // Wait for FileDB to be available
  if (typeof FileDB !== 'undefined') {
    new FileDBDemo();
  } else {
    // Retry after a short delay if FileDB is not yet loaded
    setTimeout(() => {
      if (typeof FileDB !== 'undefined') {
        new FileDBDemo();
      } else {
        console.error('FileDB SDK not loaded');
      }
    }, 100);
  }
});

// Add smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});

// Add copy-to-clipboard functionality for code blocks
document.querySelectorAll('pre code').forEach(block => {
  const wrapper = block.closest('pre');
  if (wrapper) {
    const button = document.createElement('button');
    button.className = 'absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity';
    button.textContent = 'Copy';

    wrapper.style.position = 'relative';
    wrapper.className += ' group';
    wrapper.appendChild(button);

    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(block.textContent);
        button.textContent = 'Copied!';
        setTimeout(() => {
          button.textContent = 'Copy';
        }, 2000);
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
    });
  }
});