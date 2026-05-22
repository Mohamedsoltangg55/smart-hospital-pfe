"""
model.py
--------
PyTorch Autoencoder for unsupervised audit-log anomaly detection.

Architecture (input_dim is determined by Preprocessor.n_features):
    Encoder:  input_dim -> 32 -> 16 -> bottleneck(8)
    Decoder:  bottleneck(8) -> 16 -> 32 -> input_dim
    LeakyReLU + Dropout in hidden layers; linear output.

Training objective: MSE reconstruction loss on legitimate traffic only.
Anomalies are detected at inference time by high reconstruction error.
"""
from __future__ import annotations

import torch
from torch import nn

from .config import BOTTLENECK_DIM, DROPOUT, HIDDEN_DIMS


class Autoencoder(nn.Module):
    def __init__(self, input_dim: int,
                 hidden_dims=tuple(HIDDEN_DIMS),
                 bottleneck=BOTTLENECK_DIM,
                 dropout=DROPOUT):
        super().__init__()
        self.input_dim = input_dim
        self.bottleneck = bottleneck

        # Encoder
        enc_layers = []
        prev = input_dim
        for h in hidden_dims:
            enc_layers += [nn.Linear(prev, h), nn.LeakyReLU(0.1), nn.Dropout(dropout)]
            prev = h
        enc_layers += [nn.Linear(prev, bottleneck), nn.LeakyReLU(0.1)]
        self.encoder = nn.Sequential(*enc_layers)

        # Decoder (mirror)
        dec_layers = []
        prev = bottleneck
        for h in reversed(hidden_dims):
            dec_layers += [nn.Linear(prev, h), nn.LeakyReLU(0.1), nn.Dropout(dropout)]
            prev = h
        dec_layers += [nn.Linear(prev, input_dim)]
        self.decoder = nn.Sequential(*dec_layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        z = self.encoder(x)
        return self.decoder(z)

    @torch.no_grad()
    def reconstruction_error(self, x: torch.Tensor) -> torch.Tensor:
        x_hat = self.forward(x)
        return torch.mean((x - x_hat) ** 2, dim=1)


def build_model(input_dim: int) -> Autoencoder:
    return Autoencoder(input_dim=input_dim)
