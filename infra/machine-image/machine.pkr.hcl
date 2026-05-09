packer {
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = "~> 1"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "instance_type" {
  type    = string
  default = "t3.large"
}

variable "channel" {
  type    = string
  default = "stable"
}

variable "ami_name_prefix" {
  type    = string
  default = "ank1015-machine"
}

data "amazon-ami" "ubuntu_2404" {
  filters = {
    name                = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"
    root-device-type    = "ebs"
    virtualization-type = "hvm"
  }

  most_recent = true
  owners      = ["099720109477"]
  region      = var.aws_region
}

source "amazon-ebs" "machine" {
  region        = var.aws_region
  source_ami    = data.amazon-ami.ubuntu_2404.id
  instance_type = var.instance_type
  ssh_username  = "ubuntu"
  ami_name      = "${var.ami_name_prefix}-${var.channel}-${formatdate("YYYYMMDDhhmmss", timestamp())}"

  ami_description = "ank1015 host-based developer machine image"

  launch_block_device_mappings {
    device_name           = "/dev/sda1"
    volume_size           = 80
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = true
  }

  tags = {
    Name                 = "${var.ami_name_prefix}-${var.channel}"
    "ank1015:image-kind" = "machine"
    "ank1015:channel"    = var.channel
  }
}

build {
  sources = ["source.amazon-ebs.machine"]

  provisioner "file" {
    source      = "packages/machine-bootstrap/"
    destination = "/tmp/ank1015-machine-bootstrap/"
  }

  provisioner "shell" {
    execute_command = "sudo -E bash '{{ .Path }}'"
    scripts = [
      "infra/machine-image/scripts/install-dev-tools.sh",
      "infra/machine-image/scripts/validate-dev-tools.sh",
    ]
  }

  post-processor "manifest" {
    output     = "infra/machine-image/manifest.json"
    strip_path = true
  }
}
